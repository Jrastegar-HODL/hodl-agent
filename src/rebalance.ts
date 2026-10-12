import { setTimeout as sleep } from "node:timers/promises";
import { confirm as askConfirm, isCancel } from "@clack/prompts";
import { Dapp, ethers } from "@dhedge/v2-sdk";
import { z } from "zod";
import type { OnboardedConfig } from "./config.js";
import { reportTrade, type Signal } from "./report.js";
import type { Signer } from "./signer/Signer.js";
import { EXPLORER_URL, connectVault, formatUsd, makeProvider, readHoldings, totalUsdWei, weightPct, type Holding } from "./vault.js";

// routerAddress[Network.BASE][Dapp.KYBERSWAP] in the SDK's src/config.ts (not exported by the SDK).
const KYBERSWAP_ROUTER_ADDRESS = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const MIN_TRADE_USD_WEI = ethers.utils.parseEther("0.5");
const transferEvent = new ethers.utils.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const erc20 = ["function allowance(address owner, address spender) view returns (uint256)"];

const WeightsSchema = z.record(z.string(), z.number().min(0).max(100));

// Weights must use config assets only (missing ones = 0) and sum to 100. Returns basis points per config symbol.
function toWeightBps(weights: Record<string, number>, assets: Record<string, string>): Record<string, number> {
  const bps: Record<string, number> = Object.fromEntries(Object.keys(assets).map((s) => [s, 0]));
  for (const [symbol, pct] of Object.entries(WeightsSchema.parse(weights))) {
    const known = Object.keys(assets).find((s) => s.toLowerCase() === symbol.toLowerCase());
    if (!known) throw new Error(`Unknown asset "${symbol}". This vault trades: ${Object.keys(assets).join(", ")}`);
    bps[known] = Math.round(pct * 100);
  }
  const sum = Object.values(bps).reduce((a, b) => a + b, 0);
  if (sum !== 10000) throw new Error(`Weights must sum to 100 (they sum to ${sum / 100})`);
  return bps;
}

type PlannedTrade = { side: "sell" | "buy"; holding: Holding; deltaUsdWei: ethers.BigNumber; targetZero: boolean };

export async function rebalance({
  weights,
  config,
  signer,
  yes = false,
}: {
  weights: Record<string, number>;
  config: OnboardedConfig;
  signer: Signer;
  yes?: boolean;
}): Promise<{ txHashes: string[] }> {
  const signal: Signal = { weights, created_at: new Date().toISOString() };
  const weightBps = toWeightBps(weights, config.assets);
  const usdcAddress = config.assets.USDC;
  if (!usdcAddress) throw new Error("The config has no USDC asset.");

  const provider = makeProvider(config);
  const wallet = await signer.getEthersSigner(provider);
  const traderAddress = await signer.getAddress();
  const { dhedge, pool } = await connectVault(wallet, config.vault_address);
  const holdings = await readHoldings(dhedge, pool, config.assets);
  const total = totalUsdWei(holdings);
  if (total.isZero()) throw new Error("The vault is empty. The distributor must fund it first.");

  // target_i = total * w_i / 100; delta_i = target_i - value_i
  const rows = holdings.map((h) => {
    const targetUsdWei = total.mul(weightBps[h.symbol]).div(10000);
    return { h, targetUsdWei, deltaUsdWei: targetUsdWei.sub(h.valueUsdWei) };
  });
  const plan: PlannedTrade[] = rows
    .filter(({ h, deltaUsdWei }) => h.address !== usdcAddress && deltaUsdWei.abs().gte(MIN_TRADE_USD_WEI))
    .map(({ h, deltaUsdWei }) => ({
      side: deltaUsdWei.isNegative() ? ("sell" as const) : ("buy" as const),
      holding: h,
      deltaUsdWei: deltaUsdWei.abs(),
      targetZero: weightBps[h.symbol] === 0,
    }))
    .sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1)); // sells first, to get USDC for buys

  console.log(`Vault ${config.vault_address}, total ${formatUsd(total)}`);
  console.table(
    Object.fromEntries(
      rows.map(({ h, targetUsdWei, deltaUsdWei }) => [
        h.symbol,
        {
          "before $": formatUsd(h.valueUsdWei),
          "before %": weightPct(h.valueUsdWei, total),
          "after $": formatUsd(targetUsdWei),
          "after %": weightPct(targetUsdWei, total),
          "change $": `${deltaUsdWei.isNegative() ? "-" : "+"}${formatUsd(deltaUsdWei.abs())}`,
        },
      ]),
    ),
  );
  if (plan.length === 0) {
    console.log("Already on target (every change is below $0.50). No trades.");
    return { txHashes: [] };
  }

  const maxOrderUsdWei = ethers.utils.parseEther(String(config.max_order_usd));
  const tooBig = plan.find((t) => t.deltaUsdWei.gt(maxOrderUsdWei));
  if (tooBig) {
    throw new Error(
      `The ${tooBig.side} of ${tooBig.holding.symbol} is ${formatUsd(tooBig.deltaUsdWei)}, above max_order_usd ` +
        `($${config.max_order_usd}). No trades were sent. Raise max_order_usd in ~/.hodl/config.json to allow it.`,
    );
  }

  const usdc = holdings.find((h) => h.address === usdcAddress)!;
  let usdcAvailableUnits = usdc.balanceUnits;
  const slippagePct = config.slippage_bps / 100;
  const txHashes: string[] = [];

  const send = async (
    label: string,
    amountText: string,
    estimate: () => Promise<any>,
    sendTx: (options: { gasLimit: ethers.BigNumber }) => Promise<any>,
  ) => {
    // Right after our own transaction, the RPC can answer from a node that has not seen it yet (spike step 1.3),
    // so an estimate can fail once or twice before it succeeds.
    let result = await estimate();
    for (let attempt = 1; attempt <= 3 && !result.gas; attempt++) {
      await sleep(3000);
      result = await estimate();
    }
    const gasUnits = estimatedGas(result);
    const { maxFeePerGas } = await provider.getFeeData();
    const ok = await confirmTx(yes, {
      action: label,
      fromAddress: traderAddress,
      amount: amountText,
      estimatedGasEth: ethers.utils.formatEther(gasUnits.mul(maxFeePerGas ?? 0)),
    });
    if (!ok) throw new Error("Cancelled. Trades already sent stay on-chain.");
    // Send with this gas limit, so the send does not estimate again on a lagging node. The trade re-quotes
    // KyberSwap, and the new route can use more gas, hence the margin. Only gas actually used is paid.
    const tx: ethers.providers.TransactionResponse = await sendTx({ gasLimit: gasUnits.mul(3).div(2) });
    console.log(`  Sent: ${EXPLORER_URL}/tx/${tx.hash}`);
    try {
      return await tx.wait(1);
    } catch {
      throw new Error(`Transaction failed or was not confirmed: ${EXPLORER_URL}/tx/${tx.hash}`);
    }
  };

  // The vault's router allowance must cover the trade; approve exactly the amount when it does not.
  // Each token's allowance is read from the chain once, then tracked here: a read right after our own
  // transaction can be stale.
  const allowances = new Map<string, ethers.BigNumber>();
  const ensureAllowance = async (h: Holding, amountUnits: ethers.BigNumber) => {
    if (!allowances.has(h.address)) {
      const token = new ethers.Contract(h.address, erc20, provider);
      allowances.set(h.address, await token.allowance(config.vault_address, KYBERSWAP_ROUTER_ADDRESS));
    }
    if (allowances.get(h.address)!.gte(amountUnits)) return;
    const amountText = `${ethers.utils.formatUnits(amountUnits, h.decimals)} ${h.symbol} (approval)`;
    await send(
      `Vault approves KyberSwap to spend vault ${h.symbol}`,
      amountText,
      () => pool.approve(Dapp.KYBERSWAP, h.address, amountUnits, null, { estimateGas: true }),
      (options) => pool.approve(Dapp.KYBERSWAP, h.address, amountUnits, options),
    );
    allowances.set(h.address, amountUnits);
  };

  for (const t of plan) {
    const from = t.side === "sell" ? t.holding : usdc;
    const to = t.side === "sell" ? usdc : t.holding;
    let amountUnits = usdAmountToUnits(t.deltaUsdWei, from);
    if (t.side === "sell") {
      // Selling the whole position when its target is 0 avoids leaving dust behind.
      amountUnits = t.targetZero || amountUnits.gt(from.balanceUnits) ? from.balanceUnits : amountUnits;
    } else {
      // Sells can return a little less USDC than planned (slippage); never spend more than the vault has.
      amountUnits = amountUnits.gt(usdcAvailableUnits) ? usdcAvailableUnits : amountUnits;
    }
    if (amountUnits.isZero()) continue;

    const amountText = `${ethers.utils.formatUnits(amountUnits, from.decimals)} ${from.symbol}`;
    console.log(`\n${t.side === "sell" ? "Sell" : "Buy"} ${to.symbol === "USDC" ? from.symbol : to.symbol}: ${amountText}`);
    await ensureAllowance(from, amountUnits);
    const receipt = await send(
      `Vault trades ${from.symbol} -> ${to.symbol} on KyberSwap, slippage ${slippagePct}%`,
      amountText,
      () => pool.trade(Dapp.KYBERSWAP, from.address, to.address, amountUnits, slippagePct, null, { estimateGas: true }),
      (options) => pool.trade(Dapp.KYBERSWAP, from.address, to.address, amountUnits, slippagePct, options),
    );
    txHashes.push(receipt.transactionHash);
    allowances.set(from.address, allowances.get(from.address)!.sub(amountUnits)); // the router took amountIn
    // Take the USDC received from the receipt, not a fresh read: the RPC can lag behind (spike step 1.5).
    if (t.side === "sell") usdcAvailableUnits = usdcAvailableUnits.add(received(receipt, usdcAddress, config.vault_address));
    else usdcAvailableUnits = usdcAvailableUnits.sub(amountUnits);
    await reportTrade(config, receipt.transactionHash, signal);
  }

  console.log(`\nDone: ${txHashes.length} trade(s). Run "hodl-agent status" to see the new holdings.`);
  return { txHashes };
}

const usdAmountToUnits = (usdWei: ethers.BigNumber, h: Holding) =>
  usdWei.mul(ethers.BigNumber.from(10).pow(h.decimals)).div(h.priceUsdWei);

// Sum of token transfers into `to` in this receipt.
function received(receipt: ethers.providers.TransactionReceipt, token: string, to: string): ethers.BigNumber {
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === token.toLowerCase())
    .map((log) => {
      try {
        return transferEvent.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((e) => e?.name === "Transfer" && (e.args.to as string).toLowerCase() === to.toLowerCase())
    .reduce((sum, e) => sum.add(e!.args.value), ethers.constants.Zero);
}

// SDK estimates return { gas, gasEstimationError }. Stop on an error instead of sending a failing transaction.
function estimatedGas(estimate: { gas: ethers.BigNumber | null; gasEstimationError: unknown }): ethers.BigNumber {
  if (estimate.gas) return estimate.gas;
  const err = estimate.gasEstimationError as { reason?: string; code?: string } | undefined;
  throw new Error(`Gas estimate failed, nothing was sent (${err?.reason ?? err?.code ?? "unknown reason"})`);
}

// Prints what the transaction will do, then asks y/N unless --yes.
async function confirmTx(
  yes: boolean,
  d: { action: string; fromAddress: string; amount: string; estimatedGasEth: string },
): Promise<boolean> {
  console.log(`  Action:        ${d.action}`);
  console.log(`  From wallet:   ${d.fromAddress}`);
  console.log(`  Amount:        ${d.amount}`);
  console.log(`  Estimated gas: ${d.estimatedGasEth} ETH`);
  if (yes) return true;
  const answer = await askConfirm({ message: "Send this transaction?", initialValue: false });
  return !isCancel(answer) && answer === true;
}

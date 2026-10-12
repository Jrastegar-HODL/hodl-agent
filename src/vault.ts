import { Dhedge, Network, ethers, type Pool } from "@dhedge/v2-sdk";
import type { Config, OnboardedConfig } from "./config.js";
import { getTrades, type TradeListItem } from "./report.js";

export const EXPLORER_URL = "https://basescan.org";

// ethers errors can contain the RPC URL (and an RPC key in HODL_RPC_URL), so never print them raw.
export function safeMessage(err: unknown): string {
  const e = err as { reason?: string; message?: string };
  return (e.reason ?? e.message ?? String(err)).replace(/https?:\/\/(?!basescan\.org)\S+/g, "[url hidden]");
}

// ethers v5 hard-codes a 1.5 gwei priority fee, about 250x what Base needs (spike step 1.6). Ask the node instead.
class BaseProvider extends ethers.providers.StaticJsonRpcProvider {
  async getFeeData(): Promise<ethers.providers.FeeData> {
    const [block, priorityFeeHex, gasPrice] = await Promise.all([
      this.getBlock("latest"),
      this.send("eth_maxPriorityFeePerGas", []),
      this.getGasPrice(),
    ]);
    const lastBaseFeePerGas = block.baseFeePerGas ?? ethers.constants.Zero;
    const maxPriorityFeePerGas = ethers.BigNumber.from(priorityFeeHex);
    const maxFeePerGas = lastBaseFeePerGas.mul(2).add(maxPriorityFeePerGas);
    return { lastBaseFeePerGas, maxFeePerGas, maxPriorityFeePerGas, gasPrice };
  }
}

export const makeProvider = (config: Config) => new BaseProvider(config.rpc_url, config.chain_id);

// The SDK's types ask for a Wallet, but it only uses Signer methods, so any ethers Signer works.
export async function connectVault(signer: ethers.Signer, vaultAddress: string) {
  const dhedge = new Dhedge(signer as ethers.Wallet, Network.BASE);
  return { dhedge, pool: await dhedge.loadPool(vaultAddress) };
}

export type Holding = {
  symbol: string;
  address: string;
  decimals: number;
  balanceUnits: ethers.BigNumber;
  priceUsdWei: ethers.BigNumber; // USD (18 decimals) for one whole token, from the dHEDGE oracle
  valueUsdWei: ethers.BigNumber;
};

// Holdings of the config assets, priced with the vault's own oracle (assetValue, spike step 1.2).
export async function readHoldings(dhedge: Dhedge, pool: Pool, assets: Record<string, string>): Promise<Holding[]> {
  const composition = await pool.getComposition();
  return Promise.all(
    Object.entries(assets).map(async ([symbol, address]) => {
      const decimals = await dhedge.utils.getDecimals(address);
      const oneTokenUnits = ethers.BigNumber.from(10).pow(decimals);
      const priceUsdWei: ethers.BigNumber = await pool.managerLogic["assetValue(address,uint256)"](address, oneTokenUnits);
      const balanceUnits =
        composition.find((c) => c.asset.toLowerCase() === address.toLowerCase())?.balance ?? ethers.constants.Zero;
      const valueUsdWei = balanceUnits.mul(priceUsdWei).div(oneTokenUnits);
      return { symbol, address, decimals, balanceUnits, priceUsdWei, valueUsdWei };
    }),
  );
}

export const totalUsdWei = (holdings: Holding[]) =>
  holdings.reduce((sum, h) => sum.add(h.valueUsdWei), ethers.constants.Zero);

export const weightPct = (valueUsdWei: ethers.BigNumber, totalWei: ethers.BigNumber) =>
  totalWei.isZero() ? "0.00" : (valueUsdWei.mul(10000).div(totalWei).toNumber() / 100).toFixed(2);

export const formatUsd = (usdWei: ethers.BigNumber) => `$${Number(ethers.utils.formatEther(usdWei)).toFixed(2)}`;

export type Status = {
  vaultAddress: string;
  explorerUrl: string;
  holdings: { symbol: string; balance: string; valueUsd: string; weightPct: string }[];
  totalValueUsd: string;
  sharePriceUsd: string;
  trades: TradeListItem[] | null; // null when the HODL API could not be reached
};

// Read-only, so no key is needed: a VoidSigner can read but never sign.
export async function getStatus({ config }: { config: OnboardedConfig }): Promise<Status> {
  const reader = new ethers.VoidSigner(ethers.constants.AddressZero, makeProvider(config));
  const { dhedge, pool } = await connectVault(reader, config.vault_address);
  const [holdings, sharePriceUsdWei, trades] = await Promise.all([
    readHoldings(dhedge, pool, config.assets),
    pool.poolLogic.tokenPrice() as Promise<ethers.BigNumber>,
    getTrades(config, 5).catch(() => null),
  ]);
  const total = totalUsdWei(holdings);
  return {
    vaultAddress: config.vault_address,
    explorerUrl: `${EXPLORER_URL}/address/${config.vault_address}`,
    holdings: holdings.map((h) => ({
      symbol: h.symbol,
      balance: ethers.utils.formatUnits(h.balanceUnits, h.decimals),
      valueUsd: formatUsd(h.valueUsdWei),
      weightPct: weightPct(h.valueUsdWei, total),
    })),
    totalValueUsd: formatUsd(total),
    sharePriceUsd: `$${Number(ethers.utils.formatEther(sharePriceUsdWei)).toFixed(6)}`,
    trades,
  };
}

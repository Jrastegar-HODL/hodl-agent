#!/usr/bin/env node
import { Command } from "commander";
import { z } from "zod";
import * as config from "./config.js";
import { rebalance } from "./rebalance.js";
import { KeystoreSigner, keystoreExists } from "./signer/KeystoreSigner.js";
import { listen } from "./listen.js";
import { EXPLORER_URL, getStatus, safeMessage } from "./vault.js";

const program = new Command();

program.name("hodl-agent").description("Trade a Chamber vault on Base with your own key");

program
  .command("init")
  .description("Create the trading key and save the HODL API URL")
  .option("--api-url <url>", "HODL API URL")
  .action(async (opts: { apiUrl?: string }) => {
    if (opts.apiUrl) await config.write({ api_url: opts.apiUrl });
    else await config.read().catch(() => {
      throw new Error("First run needs the HODL API URL: hodl-agent init --api-url <url>");
    });
    if (await keystoreExists()) console.log("Trading key already exists, keeping it.");
    else await KeystoreSigner.create();
    console.log(`Trading address: ${await KeystoreSigner.storedAddress()}`);
    console.log('Next: hodl-agent onboard --name "<strategy name>" --manager "<manager name>" --invite <onboarding key>');
  });

const OnboardResponse = z.object({
  strategy_id: z.string(),
  vault_address: z.string(),
  explorer_url: z.string(),
  manager_api_key: z.string(),
  sdk_config: z.object({
    strategy_id: z.string(),
    vault_address: z.string(),
    chain_id: z.literal(8453),
    assets: z.record(z.string(), z.string()),
  }),
});

program
  .command("onboard")
  .description("Register the strategy and create its vault")
  .requiredOption("--name <name>", "strategy name (3-40 characters)")
  .requiredOption("--manager <manager_name>", "asset manager name")
  .requiredOption("--invite <onboarding_key>", "onboarding key from HODL")
  .option("--description <text>", "strategy description")
  .action(async (opts: { name: string; manager: string; invite: string; description?: string }) => {
    const current = await config.read();
    if (current.strategy_id) throw new Error(`Already onboarded (strategy ${current.strategy_id}, vault ${current.vault_address}).`);
    const traderAddress = await KeystoreSigner.storedAddress();
    console.log(`Creating the vault for trader ${traderAddress}. This takes about a minute...`);
    const res = await fetch(`${current.api_url.replace(/\/$/, "")}/v1/strategies`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.invite}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: opts.name,
        manager_name: opts.manager,
        description: opts.description,
        trader_address: traderAddress,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`HODL API returned ${res.status}: ${JSON.stringify(body.error ?? body)}`);
    const data = OnboardResponse.parse(body);
    // api_url stays as given to init: the API builds sdk_config.api_url from the request, which can say http behind a proxy.
    await config.write({
      strategy_id: data.sdk_config.strategy_id,
      vault_address: data.sdk_config.vault_address,
      chain_id: data.sdk_config.chain_id,
      assets: data.sdk_config.assets,
      manager_api_key: data.manager_api_key,
    });
    console.log(`Vault address: ${data.vault_address}`);
    console.log(`Basescan:      ${data.explorer_url}`);
    console.log("Next: the distributor funds the vault");
  });

// "cbBTC=50,WETH=50" -> { cbBTC: 50, WETH: 50 }
function parseWeights(text: string): Record<string, number> {
  return Object.fromEntries(
    text.split(",").map((pair) => {
      const [symbol, pct] = pair.split("=").map((s) => s.trim());
      const value = Number(pct);
      if (!symbol || pct === undefined || pct === "" || !Number.isFinite(value)) {
        throw new Error(`Bad weight "${pair}". Use SYMBOL=PCT, for example cbBTC=50,WETH=50`);
      }
      return [symbol, value];
    }),
  );
}

program
  .command("rebalance")
  .description("Trade the vault to target weights")
  .requiredOption("--weights <SYMBOL=PCT,...>", "target weights that sum to 100, for example cbBTC=50,WETH=50")
  .option("--yes", "send without asking for confirmation")
  .action(async (opts: { weights: string; yes?: boolean }) => {
    const weights = parseWeights(opts.weights);
    const cfg = await config.requireOnboarded();
    const signer = await KeystoreSigner.load();
    await rebalance({ weights, config: cfg, signer, yes: opts.yes });
  });

program
  .command("status")
  .description("Show holdings, weights, share price and recent trades")
  .action(async () => {
    const s = await getStatus({ config: await config.requireOnboarded() });
    console.log(`Vault:       ${s.vaultAddress}  (${s.explorerUrl})`);
    console.table(
      Object.fromEntries(s.holdings.map((h) => [h.symbol, { balance: h.balance, "value $": h.valueUsd, "weight %": h.weightPct }])),
    );
    console.log(`Total value: ${s.totalValueUsd}`);
    console.log(`Share price: ${s.sharePriceUsd}`);
    if (!s.trades) console.log("Last trades: could not reach the HODL API");
    else if (s.trades.length === 0) console.log("Last trades: none yet");
    else {
      console.log("Last trades:");
      for (const t of s.trades) console.log(`  ${t.created_at}  ${EXPLORER_URL}/tx/${t.tx_hash}`);
    }
  });

program
  .command("listen")
  .description("Receive weight signals on a local endpoint and trade them (needs HODL_AGENT_PASSWORD, HODL_SIGNAL_SECRET)")
  .option("--port <port>", "local port", "8787")
  .action(async (opts: { port: string }) => {
    await listen({ port: z.coerce.number().int().min(1).max(65535).parse(opts.port) });
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${safeMessage(err)}`);
  process.exit(1);
});

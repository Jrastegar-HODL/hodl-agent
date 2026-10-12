import { setTimeout as sleep } from "node:timers/promises";
import type { OnboardedConfig } from "./config.js";

export type Signal = { weights: Record<string, number>; created_at: string };
export type TradeListItem = { trade_id: string; tx_hash: string; block_number: number; explorer_url: string; created_at: string };

const tradesUrl = (config: OnboardedConfig) =>
  `${config.api_url.replace(/\/$/, "")}/v1/strategies/${config.strategy_id}/trades`;
const auth = (config: OnboardedConfig) => ({ authorization: `Bearer ${config.manager_api_key}` });

// Records a trade with HODL. The trade is already final on-chain, so a failure here only warns.
export async function reportTrade(config: OnboardedConfig, txHash: string, signal: Signal): Promise<void> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    // The API's RPC node can be a few seconds behind ours, so wait before each retry.
    if (attempt > 0) await sleep(3000);
    try {
      const res = await fetch(tradesUrl(config), {
        method: "POST",
        headers: { ...auth(config), "content-type": "application/json" },
        body: JSON.stringify({ tx_hash: txHash, signal }),
      });
      if (res.ok) {
        console.log("  Recorded by the HODL API.");
        return;
      }
    } catch {}
  }
  console.warn(`  Warning: trade ${txHash} is valid on-chain but was not recorded by the HODL API.`);
}

export async function getTrades(config: OnboardedConfig, limit: number): Promise<TradeListItem[]> {
  const res = await fetch(tradesUrl(config), { headers: auth(config) });
  if (!res.ok) throw new Error(`HODL API returned ${res.status}`);
  const { trades } = (await res.json()) as { trades: TradeListItem[] };
  return trades.slice(0, limit);
}

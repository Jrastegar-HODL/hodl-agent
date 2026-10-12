import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import * as configFile from "./config.js";
import { rebalance, toWeightBps } from "./rebalance.js";
import { KeystoreSigner } from "./signer/KeystoreSigner.js";
import { EXPLORER_URL, safeMessage } from "./vault.js";

type PendingSignal = { signalId: string; weights: Record<string, number> };
type Result = { signal_id: string; ok: boolean; tx_hashes?: string[]; error?: string; finished_at: string };

const SignalBody = z.object({ weights: z.record(z.string(), z.number()) });

// Compare hashes so both sides have the same length, in constant time.
const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

export async function listen({ port }: { port: number }) {
  const secret = process.env.HODL_SIGNAL_SECRET;
  if (!process.env.HODL_AGENT_PASSWORD) throw new Error("Set HODL_AGENT_PASSWORD first: read -s HODL_AGENT_PASSWORD; export HODL_AGENT_PASSWORD");
  if (!secret) throw new Error("Set HODL_SIGNAL_SECRET first: export HODL_SIGNAL_SECRET=<secret>");
  const config = await configFile.requireOnboarded();
  const signer = await KeystoreSigner.load(); // once, from HODL_AGENT_PASSWORD

  let running = false;
  let next: PendingSignal | null = null; // only the newest waiting signal is kept
  let lastSignalAt: string | null = null;
  let lastResult: Result | null = null;

  // One signal at a time. When it finishes, run the newest signal that arrived meanwhile.
  async function drain() {
    if (running) return;
    running = true;
    while (next) {
      const { signalId, weights } = next;
      next = null;
      console.log(`\n[${new Date().toISOString()}] Signal ${signalId}: ${JSON.stringify(weights)}`);
      try {
        const { txHashes } = await rebalance({ weights, config, signer, yes: true });
        lastResult = { signal_id: signalId, ok: true, tx_hashes: txHashes, finished_at: new Date().toISOString() };
        console.log(`Signal ${signalId} done: ${txHashes.length} trade(s)`);
        for (const hash of txHashes) console.log(`  ${EXPLORER_URL}/tx/${hash}`);
      } catch (err) {
        lastResult = { signal_id: signalId, ok: false, error: safeMessage(err), finished_at: new Date().toISOString() };
        console.error(`Signal ${signalId} failed: ${lastResult.error}`);
      }
    }
    running = false;
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return send(res, 200, { status: running ? "running" : "idle", last_signal_at: lastSignalAt, last_result: lastResult });
      }
      if (req.method !== "POST" || req.url !== "/signal") return send(res, 404, { error: "not found" });

      const given = req.headers["x-signal-secret"];
      if (typeof given !== "string" || !sameSecret(given, secret)) {
        console.warn(`[${new Date().toISOString()}] Rejected a signal with a wrong or missing secret`);
        return send(res, 401, { error: "wrong or missing x-signal-secret" });
      }

      let weights: Record<string, number>;
      try {
        weights = SignalBody.parse(JSON.parse(await readBody(req))).weights;
        toWeightBps(weights, config.assets); // same rules as rebalance: known assets, sum 100
      } catch (err) {
        return send(res, 400, { error: err instanceof z.ZodError ? "body must be {\"weights\": {\"SYMBOL\": PCT}}" : safeMessage(err) });
      }

      const signalId = randomUUID();
      lastSignalAt = new Date().toISOString();
      if (next) console.log(`Signal ${next.signalId} replaced by newer signal ${signalId}`);
      next = { signalId, weights };
      send(res, 202, { signal_id: signalId });
      void drain();
    } catch (err) {
      send(res, 500, { error: safeMessage(err) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve); // this machine only
  });
  console.log(`Trading address: ${await signer.getAddress()}`);
  console.log(`Vault:           ${config.vault_address}`);
  console.log(`Listening on http://127.0.0.1:${port} (POST /signal, GET /health). Ctrl+C to stop.`);
}

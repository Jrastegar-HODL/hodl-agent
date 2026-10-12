import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const hodlDir = () => join(homedir(), ".hodl");
const configPath = () => join(hodlDir(), "config.json");

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

const ConfigSchema = z.object({
  api_url: z.url(),
  rpc_url: z.url().default("https://mainnet.base.org"),
  chain_id: z.literal(8453).default(8453),
  strategy_id: z.string().optional(),
  vault_address: address.optional(),
  manager_api_key: z.string().optional(),
  assets: z.record(z.string(), address).optional(),
  max_order_usd: z.number().positive().default(10),
  slippage_bps: z.number().int().min(1).max(10000).default(100),
});

export type Config = z.infer<typeof ConfigSchema>;
export type OnboardedConfig = Config &
  Required<Pick<Config, "strategy_id" | "vault_address" | "manager_api_key" | "assets">>;

async function readFileConfig(): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function read(): Promise<Config> {
  const raw = await readFileConfig();
  if (!raw) throw new Error("No config found. Run: hodl-agent init");
  const config = ConfigSchema.parse(raw);
  // HODL_RPC_URL replaces the saved RPC for this run only; it is never written to the file.
  if (process.env.HODL_RPC_URL) config.rpc_url = z.url().parse(process.env.HODL_RPC_URL);
  return config;
}

export async function write(partial: Partial<Config>): Promise<Config> {
  const config = ConfigSchema.parse({ ...(await readFileConfig()), ...partial });
  await mkdir(hodlDir(), { recursive: true, mode: 0o700 });
  await writeFile(configPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(configPath(), 0o600); // mode above only applies when the file is new
  return config;
}

export async function requireOnboarded(): Promise<OnboardedConfig> {
  const config = await read();
  const { strategy_id, vault_address, manager_api_key, assets } = config;
  if (!strategy_id || !vault_address || !manager_api_key || !assets) {
    throw new Error("This agent is not onboarded yet. Run: hodl-agent onboard");
  }
  return { ...config, strategy_id, vault_address, manager_api_key, assets };
}

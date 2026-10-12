// Step 2.8 test. Run after `npx tsc`: node test/keystore.test.mjs
// Uses a throwaway HOME, so the real ~/.hodl is never touched. Any 12+ character password works.
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "hodl-test-"));
process.env.HOME = home;
delete process.env.HODL_AGENT_PASSWORD;

const { KeystoreSigner, keystorePath } = await import("../dist/signer/KeystoreSigner.js");
const config = await import("../dist/config.js");
const mode = async (p) => ((await stat(p)).mode & 0o777).toString(8);
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};

try {
  console.log("1) Create a keystore (type a test password two times)");
  const created = await KeystoreSigner.create();
  const address = await created.getAddress();
  console.log(`   Address: ${address}`);
  check((await mode(keystorePath())) === "600", "keystore file mode is 600");

  console.log("2) Load it again (type the same password)");
  const loaded = await KeystoreSigner.load();
  check((await loaded.getAddress()) === address, "loaded address matches");

  const refused = await KeystoreSigner.create().then(() => false, () => true);
  check(refused, "create() refuses to overwrite the keystore");

  await config.write({ api_url: "https://example.com" });
  check((await mode(join(home, ".hodl", "config.json"))) === "600", "config file mode is 600");
  const c = await config.read();
  check(c.rpc_url === "https://mainnet.base.org" && c.max_order_usd === 10 && c.slippage_bps === 100, "config defaults");
} finally {
  await rm(home, { recursive: true, force: true });
}

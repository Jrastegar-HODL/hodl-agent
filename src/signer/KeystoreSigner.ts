import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isCancel, password } from "@clack/prompts";
import { ethers } from "@dhedge/v2-sdk";
import { hodlDir } from "../config.js";
import type { Signer } from "./Signer.js";

const MIN_PASSWORD_LENGTH = 12;
export const keystorePath = () => join(hodlDir(), "keystore.json");

async function askPassword(message: string): Promise<string> {
  const value = await password({
    message,
    validate: (v) =>
      (v ?? "").length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters` : undefined,
  });
  if (isCancel(value)) throw new Error("Cancelled");
  return value;
}

export async function keystoreExists(): Promise<boolean> {
  return access(keystorePath()).then(
    () => true,
    () => false,
  );
}

export class KeystoreSigner implements Signer {
  private constructor(private readonly wallet: ethers.Wallet) {}

  // Makes a new random trading key and saves it encrypted. Never overwrites an existing keystore.
  static async create(): Promise<KeystoreSigner> {
    if (await keystoreExists()) {
      throw new Error(`A keystore already exists at ${keystorePath()}. It was not changed.`);
    }
    const pw = await askPassword(`New keystore password (min ${MIN_PASSWORD_LENGTH} characters)`);
    const pwAgain = await askPassword("Repeat the password");
    if (pw !== pwAgain) throw new Error("The passwords do not match. Nothing was saved.");

    const wallet = ethers.Wallet.createRandom();
    const json = await wallet.encrypt(pw);
    await mkdir(hodlDir(), { recursive: true, mode: 0o700 });
    // "wx" fails if the file appeared in the meantime, so an existing key is never replaced.
    await writeFile(keystorePath(), json, { mode: 0o600, flag: "wx" });
    return new KeystoreSigner(wallet);
  }

  // Password comes from HODL_AGENT_PASSWORD (for listen) or from a prompt.
  static async load(): Promise<KeystoreSigner> {
    if (!(await keystoreExists())) throw new Error("No keystore found. Run: hodl-agent init");
    const json = await readFile(keystorePath(), "utf8");
    const pw = process.env.HODL_AGENT_PASSWORD ?? (await askPassword("Keystore password"));
    try {
      return new KeystoreSigner(await ethers.Wallet.fromEncryptedJson(json, pw));
    } catch {
      throw new Error("Could not unlock the keystore. Check the password.");
    }
  }

  // The keystore stores its address in clear text, so this needs no password.
  static async storedAddress(): Promise<string> {
    if (!(await keystoreExists())) throw new Error("No keystore found. Run: hodl-agent init");
    return ethers.utils.getAddress(ethers.utils.getJsonWalletAddress(await readFile(keystorePath(), "utf8")));
  }

  async getAddress(): Promise<string> {
    return this.wallet.address;
  }

  async getEthersSigner(provider: ethers.providers.Provider): Promise<ethers.Signer> {
    return this.wallet.connect(provider);
  }
}

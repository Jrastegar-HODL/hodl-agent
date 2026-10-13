import { ethers } from "@dhedge/v2-sdk";

// Signs for the vault's trader. KeystoreSigner is the built-in implementation.
export interface Signer {
  getAddress(): Promise<string>;
  getEthersSigner(provider: ethers.providers.Provider): Promise<ethers.Signer>;
}

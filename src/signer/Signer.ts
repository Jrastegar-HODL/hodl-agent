import { ethers } from "@dhedge/v2-sdk";

// The only signer abstraction. KeystoreSigner is the MVP implementation.
export interface Signer {
  getAddress(): Promise<string>;
  getEthersSigner(provider: ethers.providers.Provider): Promise<ethers.Signer>;
}

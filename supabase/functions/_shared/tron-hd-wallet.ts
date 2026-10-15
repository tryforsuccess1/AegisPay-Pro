import { TronWeb } from "npm:tronweb@6.0.4";
export const TRON_HD_BASE_PATH = "m/44'/195'/0'/0";
export type TronHdIdentity = { address: string; privateKey: string; rootFingerprint: string; derivationPath: string };

function getChild(mnemonic: string, passphrase: string, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 2147483648) throw new Error("The TRON HD derivation index is out of range.");
  const derivationPath = `${TRON_HD_BASE_PATH}/${index}`;
  const account = TronWeb.fromMnemonic(mnemonic, derivationPath, passphrase);
  const address = String(account.address || "");
  const privateKey = String(account.privateKey || "").replace(/^0x/i, "");
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) || !/^[a-fA-F0-9]{64}$/.test(privateKey)) throw new Error("The TRON HD wallet could not derive a valid child account.");
  if (TronWeb.address.fromPrivateKey(privateKey) !== address) throw new Error("The derived TRON address does not match its private key.");
  return { address, privateKey, derivationPath };
}

export async function deriveTronHdIdentity(mnemonic: string, passphrase: string, index: number): Promise<TronHdIdentity> {
  const normalizedMnemonic = String(mnemonic || "").trim().replace(/\s+/g, " ");
  if (!normalizedMnemonic) throw new Error("TRON_HD_WALLET_MNEMONIC is not configured.");
  const rootChild = getChild(normalizedMnemonic, passphrase, 0);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rootChild.address));
  const rootFingerprint = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const child = index === 0 ? rootChild : getChild(normalizedMnemonic, passphrase, index);
  return { address: child.address, privateKey: child.privateKey, rootFingerprint, derivationPath: child.derivationPath };
}

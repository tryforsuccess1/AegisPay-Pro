import { assertEquals, assertNotEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import { deriveTronHdIdentity } from "./tron-hd-wallet.ts";
const PUBLIC_TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
Deno.test("TRON HD derivation is deterministic and index-separated", async () => {
  const one = await deriveTronHdIdentity(PUBLIC_TEST_MNEMONIC, "", 1);
  const repeated = await deriveTronHdIdentity(PUBLIC_TEST_MNEMONIC, "", 1);
  const two = await deriveTronHdIdentity(PUBLIC_TEST_MNEMONIC, "", 2);
  assertMatch(one.address, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  assertEquals(one.address, repeated.address);
  assertNotEquals(one.address, two.address);
  assertEquals(one.rootFingerprint, two.rootFingerprint);
  assertMatch(one.privateKey, /^[a-fA-F0-9]{64}$/);
  assertEquals(one.derivationPath, "m/44'/195'/0'/0/1");
});
Deno.test("TRON HD derivation rejects invalid indexes", async () => {
  let failed = false;
  try { await deriveTronHdIdentity(PUBLIC_TEST_MNEMONIC, "", -1); } catch { failed = true; }
  if (!failed) throw new Error("Negative HD derivation index should be rejected.");
});

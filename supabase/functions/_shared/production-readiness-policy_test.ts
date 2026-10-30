import { assertEquals } from "jsr:@std/assert@1.0.14";
import { areNetworkSecretsSafelySeparated } from "./production-readiness-policy.ts";

const SAFE_CHECKS = {
  payoutKeysSafelySeparated: true,
  mainnetHdMnemonicAliasConflict: false,
  shastaHdMnemonicAliasConflict: false,
  mainnetHdPassphraseAliasConflict: false,
  shastaHdPassphraseAliasConflict: false,
  mainnetShastaHdMnemonicsDistinct: true,
  withdrawalPayoutSeedDistinct: true,
};

Deno.test("secret separation passes independently of disabled payout mode", () => {
  // Payout mode is intentionally not part of the separation contract.
  // Operational payout readiness is checked separately by the readiness handler.
  assertEquals(areNetworkSecretsSafelySeparated(SAFE_CHECKS), true);
});

Deno.test("secret separation fails when payout signing keys are not distinct", () => {
  assertEquals(areNetworkSecretsSafelySeparated({
    ...SAFE_CHECKS,
    payoutKeysSafelySeparated: false,
  }), false);
});

Deno.test("secret separation fails on any HD mnemonic or passphrase alias conflict", () => {
  for (const key of [
    "mainnetHdMnemonicAliasConflict",
    "shastaHdMnemonicAliasConflict",
    "mainnetHdPassphraseAliasConflict",
    "shastaHdPassphraseAliasConflict",
  ] as const) {
    assertEquals(areNetworkSecretsSafelySeparated({
      ...SAFE_CHECKS,
      [key]: true,
    }), false, key);
  }
});

Deno.test("secret separation fails when Mainnet and Shasta HD mnemonics are shared", () => {
  assertEquals(areNetworkSecretsSafelySeparated({
    ...SAFE_CHECKS,
    mainnetShastaHdMnemonicsDistinct: false,
  }), false);
});

Deno.test("secret separation fails when withdrawal seed is missing or reused", () => {
  assertEquals(areNetworkSecretsSafelySeparated({
    ...SAFE_CHECKS,
    withdrawalPayoutSeedDistinct: false,
  }), false);
});

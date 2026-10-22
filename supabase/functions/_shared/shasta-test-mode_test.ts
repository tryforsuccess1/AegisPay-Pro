import { assertEquals } from "jsr:@std/assert@1";
import {
  validShastaTestRules,
  shastaSecretsAreDistinct,
  isAllowlistedShastaTestUser,
  loadShastaTestRules,
} from "./shasta-test-mode.ts";
import { TRON_SHASTA_USDT_CONTRACT } from "./tron-deposit-validation.ts";

const SHASTA_ADDRESS = "T" + "5".repeat(33);
const MAINNET_ADDRESS = "T" + "4".repeat(33);
const settings = (overrides: Record<string, unknown> = {}) => ({
  shasta_testnet_rules: {
    network: "TRON TESTNET",
    token_contract: TRON_SHASTA_USDT_CONTRACT,
    receiving_address: SHASTA_ADDRESS,
  },
  deposit_rules: {
    network: "TRON MAINNET",
    token_contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    receiving_address: MAINNET_ADDRESS,
  },
  system_mode: {
    mode: "MAINNET",
    live_deposits: false,
    real_payouts: false,
    production_go_live_approved: false,
  },
  production_config: {
    environment: "PRE_PRODUCTION",
    live_deposits_enabled: false,
    real_payouts_enabled: false,
    go_live_approved: false,
    payouts_locked: true,
  },
  ...overrides,
});

function mockAdmin(config: Record<string, unknown>) {
  return {
    from: (_table: string) => ({
      select: (_columns?: string) => ({
        eq: (_column: string, key: string) => ({
          maybeSingle: async () => ({
            data: config[key] ? { value_json: config[key] } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

Deno.test("Shasta config accepts only pinned contract and TRON TESTNET", () => {
  assertEquals(validShastaTestRules({
    network: "TRON TESTNET",
    token_contract: TRON_SHASTA_USDT_CONTRACT,
    receiving_address: SHASTA_ADDRESS,
  }), true);
  assertEquals(validShastaTestRules({
    network: "TRON MAINNET",
    token_contract: TRON_SHASTA_USDT_CONTRACT,
    receiving_address: SHASTA_ADDRESS,
  }), false);
  assertEquals(validShastaTestRules({
    network: "TRON TESTNET",
    token_contract: "TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn",
    receiving_address: SHASTA_ADDRESS,
  }), false);
});

Deno.test("Shasta test allowlisting fails closed without the explicit feature flag", async () => {
  const admin = { from: () => { throw new Error("database must not be queried while disabled"); } };
  assertEquals(await isAllowlistedShastaTestUser(admin, "11111111-1111-4111-8111-111111111111", false), false);
  assertEquals(await isAllowlistedShastaTestUser(admin, "not-a-user-id", true), false);
});

Deno.test("Shasta config loads only when live-money gates are closed and treasury is distinct", async () => {
  const config = settings();
  assertEquals((await loadShastaTestRules(mockAdmin(config) as any, true))?.receiving_address, SHASTA_ADDRESS);

  const openGates = settings({
    system_mode: {
      mode: "MAINNET",
      live_deposits: true,
      real_payouts: false,
      production_go_live_approved: false,
    },
  });
  assertEquals(await loadShastaTestRules(mockAdmin(openGates) as any, true), null);

  const reusedTreasury = settings({
    shasta_testnet_rules: {
      network: "TRON TESTNET",
      token_contract: TRON_SHASTA_USDT_CONTRACT,
      receiving_address: MAINNET_ADDRESS,
    },
  });
  assertEquals(await loadShastaTestRules(mockAdmin(reusedTreasury) as any, true), null);
});

Deno.test("Shasta config fails closed if Mainnet config cannot be verified", async () => {
  const missingMainnet = settings();
  delete (missingMainnet as Record<string, unknown>).deposit_rules;
  assertEquals(await loadShastaTestRules(mockAdmin(missingMainnet) as any, true), null);
});

Deno.test("Shasta secrets reject Mainnet HD mnemonic or payout signer reuse", () => {
  assertEquals(shastaSecretsAreDistinct("apple beta gamma", "Apple   beta gamma", "test-key", "main-key"), false);
  assertEquals(shastaSecretsAreDistinct("test seed", "mainnet seed", "ABCD", "abcd"), false);
  assertEquals(shastaSecretsAreDistinct("test seed", "mainnet seed", "0xAbCd", "abcd"), false);
  assertEquals(shastaSecretsAreDistinct("test seed", "mainnet seed", "test-key", "main-key"), true);
});

Deno.test("Shasta signer separation fails closed when any required secret is missing", () => {
  assertEquals(shastaSecretsAreDistinct("", "mainnet seed", "test-key", "main-key"), false);
  assertEquals(shastaSecretsAreDistinct("test seed", "", "test-key", "main-key"), false);
  assertEquals(shastaSecretsAreDistinct("test seed", "mainnet seed", "", "main-key"), false);
  assertEquals(shastaSecretsAreDistinct("test seed", "mainnet seed", "test-key", ""), false);
});

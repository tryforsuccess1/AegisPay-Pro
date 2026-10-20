import { assertEquals } from "jsr:@std/assert@1";
import { validShastaTestRules, isAllowlistedShastaTestUser } from "./shasta-test-mode.ts";
import { TRON_SHASTA_USDT_CONTRACT } from "./tron-deposit-validation.ts";

Deno.test("Shasta test configuration accepts only pinned contract and TRON TESTNET", () => {
  assertEquals(validShastaTestRules({
    network: "TRON TESTNET",
    token_contract: TRON_SHASTA_USDT_CONTRACT,
    receiving_address: "T" + "4".repeat(33),
  }), true);
  assertEquals(validShastaTestRules({
    network: "TRON MAINNET",
    token_contract: TRON_SHASTA_USDT_CONTRACT,
    receiving_address: "T" + "4".repeat(33),
  }), false);
  assertEquals(validShastaTestRules({
    network: "TRON TESTNET",
    token_contract: "TSvB9Y8S7b4Nw72Grvw1P6fJbfs6jP3ZKn",
    receiving_address: "T" + "4".repeat(33),
  }), false);
});

Deno.test("Shasta test allowlisting fails closed without the explicit feature flag", async () => {
  const admin = { from: () => { throw new Error("database must not be queried while disabled"); } };
  assertEquals(await isAllowlistedShastaTestUser(admin, "11111111-1111-4111-8111-111111111111", false), false);
  assertEquals(await isAllowlistedShastaTestUser(admin, "not-a-user-id", true), false);
});

import { assertEquals } from "jsr:@std/assert@1.0.14";
import { isIsolatedShastaPayoutEligible, type ShastaTestRules } from "./shasta-test-mode.ts";

const VALID_RULES: ShastaTestRules = {
  network: "TRON TESTNET",
  token_contract: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
  receiving_address: "TH7NgA7G17X4hm88SPL9TPptnmsSx7PbMR",
};

Deno.test("isolated Shasta payout requires the flag, MAINNET mode, allowlisted test user and valid Shasta rules", () => {
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", true, VALID_RULES), true);
  assertEquals(isIsolatedShastaPayoutEligible(false, "MAINNET", true, VALID_RULES), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", false, VALID_RULES), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", true, null), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "TESTNET_DEMO", true, VALID_RULES), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", true, {
    ...VALID_RULES,
    network: "TRON MAINNET",
  }), false);
});

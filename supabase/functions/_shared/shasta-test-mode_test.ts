import { assertEquals } from "jsr:@std/assert@1.0.14";
import { isAllowlistedShastaTestWithdrawal, isIsolatedShastaPayoutEligible, type ShastaTestRules } from "./shasta-test-mode.ts";

const VALID_RULES: ShastaTestRules = {
  network: "TRON TESTNET",
  token_contract: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
  receiving_address: "TH7NgA7G17X4hm88SPL9TPptnmsSx7PbMR",
};

Deno.test("isolated Shasta payout requires the flag, MAINNET mode, allowlisted test user, explicitly allowlisted withdrawal and valid Shasta rules", () => {
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", true, true, VALID_RULES), true);
  assertEquals(isIsolatedShastaPayoutEligible(false, "MAINNET", true, true, VALID_RULES), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", false, true, VALID_RULES), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", true, false, VALID_RULES), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", true, true, null), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "TESTNET_DEMO", true, true, VALID_RULES), false);
  assertEquals(isIsolatedShastaPayoutEligible(true, "MAINNET", true, true, {
    ...VALID_RULES,
    network: "TRON MAINNET",
  }), false);
});

function fakeWithdrawalAllowlistAdmin(data: unknown, error: unknown = null) {
  const query = {
    eq(_column: string, _value: unknown) { return query; },
    async maybeSingle() { return { data, error }; },
  };
  return {
    from(table: string) {
      if (table !== "shasta_test_withdrawals") throw new Error("Unexpected allowlist table");
      return { select(_columns: string) { return query; } };
    },
  } as any;
}

Deno.test("Shasta routing requires the exact withdrawal ID and exact allowlisted recipient address", async () => {
  const id = "9bb6aa54-c060-4fa6-837e-82460a5894c0";
  const recipient = "TKAJDPrY1utabzYAecHFogXiTRLkaxDdRi";
  const permit = { withdrawal_id: id, destination_address: recipient };
  assertEquals(await isAllowlistedShastaTestWithdrawal(fakeWithdrawalAllowlistAdmin(permit), id, true, recipient), true);
  assertEquals(await isAllowlistedShastaTestWithdrawal(fakeWithdrawalAllowlistAdmin({ ...permit, destination_address: "TH7NgA7G17X4hm88SPL9TPptnmsSx7PbMR" }), id, true, recipient), false);
  assertEquals(await isAllowlistedShastaTestWithdrawal(fakeWithdrawalAllowlistAdmin({ withdrawal_id: id, destination_address: null }), id, true, recipient), false);
  assertEquals(await isAllowlistedShastaTestWithdrawal(fakeWithdrawalAllowlistAdmin(null), id, true, recipient), false);
  assertEquals(await isAllowlistedShastaTestWithdrawal(fakeWithdrawalAllowlistAdmin(permit, { message: "db unavailable" }), id, true, recipient), false);
  assertEquals(await isAllowlistedShastaTestWithdrawal(fakeWithdrawalAllowlistAdmin(permit), id, false, recipient), false);
  assertEquals(await isAllowlistedShastaTestWithdrawal(fakeWithdrawalAllowlistAdmin(permit), "not-a-uuid", true, recipient), false);
  assertEquals(await isAllowlistedShastaTestWithdrawal(fakeWithdrawalAllowlistAdmin(permit), id, true, recipient.toLowerCase()), false);
});

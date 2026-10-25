import { assertEquals } from "jsr:@std/assert@1.0.14";
import { checkWithdrawalPayoutHdConfig, estimatePayoutFeeReserveSun } from "./withdrawal-payout-wallet.ts";

const MAINNET_SEED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const OTHER_SEED = "legal winner thank year wave sausage worth useful legal winner thank yellow";

Deno.test("per-withdrawal payout mode requires a separate seed from deposit and Shasta", () => {
  assertEquals(checkWithdrawalPayoutHdConfig("DISABLED", OTHER_SEED, MAINNET_SEED, "shasta seed").ready, false);
  assertEquals(checkWithdrawalPayoutHdConfig("EPHEMERAL_HD", MAINNET_SEED, MAINNET_SEED, OTHER_SEED).ready, false);
  assertEquals(checkWithdrawalPayoutHdConfig("EPHEMERAL_HD", OTHER_SEED, MAINNET_SEED, OTHER_SEED).ready, false);
  const ready = checkWithdrawalPayoutHdConfig("EPHEMERAL_HD", OTHER_SEED, MAINNET_SEED, "shasta seed");
  assertEquals(ready.ready, true);
  assertEquals(ready.distinctFromDepositSeed, true);
  assertEquals(ready.distinctFromShastaSeed, true);
});

Deno.test("payout energy reserve includes safety buffer and stays under configured cap", () => {
  const reserve = estimatePayoutFeeReserveSun(65000, 100, 80);
  if (!reserve.ok) throw new Error("Expected a valid energy reserve");
  assertEquals(reserve.reserveSun, 10_775_000n);
  assertEquals(reserve.estimatedEnergy, 65000);
  assertEquals(estimatePayoutFeeReserveSun(1_000_000, 1000, 50).ok, false);
  assertEquals(estimatePayoutFeeReserveSun(0, 100).ok, false);
  assertEquals(estimatePayoutFeeReserveSun(65000, 100, 101).ok, false);
});

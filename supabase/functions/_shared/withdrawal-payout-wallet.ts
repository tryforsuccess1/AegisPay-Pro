export type WithdrawalPayoutHdConfig = {
  modeEnabled: boolean;
  mnemonicPresent: boolean;
  matchesDepositSeed: boolean;
  matchesShastaSeed: boolean;
  distinctFromDepositSeed: boolean;
  distinctFromShastaSeed: boolean;
  ready: boolean;
};

function normalizePhrase(value: string): string {
  return String(value || "").trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export function checkWithdrawalPayoutHdConfig(
  mode: string,
  payoutMnemonic: string,
  depositMnemonic: string,
  shastaMnemonic: string,
): WithdrawalPayoutHdConfig {
  const payout = normalizePhrase(payoutMnemonic);
  const deposit = normalizePhrase(depositMnemonic);
  const shasta = normalizePhrase(shastaMnemonic);
  const modeEnabled = String(mode || "").trim().toUpperCase() === "EPHEMERAL_HD";
  const mnemonicPresent = payout.length > 0;
  const matchesDepositSeed = mnemonicPresent && deposit.length > 0 && payout === deposit;
  const matchesShastaSeed = mnemonicPresent && shasta.length > 0 && payout === shasta;
  const distinctFromDepositSeed = mnemonicPresent && deposit.length > 0 && !matchesDepositSeed;
  const distinctFromShastaSeed = mnemonicPresent && shasta.length > 0 && !matchesShastaSeed;
  return {
    modeEnabled,
    mnemonicPresent,
    matchesDepositSeed,
    matchesShastaSeed,
    distinctFromDepositSeed,
    distinctFromShastaSeed,
    ready: modeEnabled && mnemonicPresent && distinctFromDepositSeed && distinctFromShastaSeed,
  };
}

export type PayoutFeeReserve =
  | { ok: true; reserveSun: bigint; estimatedEnergy: number; energyFeeSun: number }
  | { ok: false; code: "INVALID_ENERGY_ESTIMATE" | "FEE_RESERVE_EXCEEDED" | "INVALID_FEE_CAP" };

export function estimatePayoutFeeReserveSun(
  energyRequired: number,
  energyFeeSun: number,
  maxReserveTrx = 80,
): PayoutFeeReserve {
  if (!Number.isFinite(maxReserveTrx) || maxReserveTrx < 3 || maxReserveTrx > 100) {
    return { ok: false, code: "INVALID_FEE_CAP" };
  }
  if (
    !Number.isSafeInteger(energyRequired) || energyRequired <= 0 || energyRequired > 1_000_000 ||
    !Number.isSafeInteger(energyFeeSun) || energyFeeSun <= 0 || energyFeeSun > 1_000_000
  ) {
    return { ok: false, code: "INVALID_ENERGY_ESTIMATE" };
  }
  // 35% safety factor plus 2 TRX buffer for bandwidth/account overhead.
  const raw = Math.max(3_000_000, Math.ceil(energyRequired * energyFeeSun * 1.35 + 2_000_000));
  const cap = Math.floor(maxReserveTrx * 1_000_000);
  if (!Number.isSafeInteger(raw) || raw > cap) {
    return { ok: false, code: "FEE_RESERVE_EXCEEDED" };
  }
  return {
    ok: true,
    reserveSun: BigInt(raw),
    estimatedEnergy: energyRequired,
    energyFeeSun,
  };
}

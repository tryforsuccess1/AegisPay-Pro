export type NetworkSecretSeparationChecks = {
  payoutKeysSafelySeparated: boolean;
  mainnetHdMnemonicAliasConflict: boolean;
  shastaHdMnemonicAliasConflict: boolean;
  mainnetHdPassphraseAliasConflict: boolean;
  shastaHdPassphraseAliasConflict: boolean;
  mainnetShastaHdMnemonicsDistinct: boolean;
  withdrawalPayoutSeedDistinct: boolean;
};

/**
 * Reports whether network signing secrets and HD seeds are distinct.
 *
 * This deliberately does not depend on whether withdrawal payouts are enabled,
 * whether fee reserves are configured, or whether a wallet is operationally
 * ready. Those are separate readiness gates. A DISABLED payout mode is expected
 * while the system is locked in PRE_PRODUCTION and must not look like key reuse.
 */
export function areNetworkSecretsSafelySeparated(
  checks: NetworkSecretSeparationChecks,
): boolean {
  return checks.payoutKeysSafelySeparated
    && !checks.mainnetHdMnemonicAliasConflict
    && !checks.shastaHdMnemonicAliasConflict
    && !checks.mainnetHdPassphraseAliasConflict
    && !checks.shastaHdPassphraseAliasConflict
    && checks.mainnetShastaHdMnemonicsDistinct
    && checks.withdrawalPayoutSeedDistinct;
}

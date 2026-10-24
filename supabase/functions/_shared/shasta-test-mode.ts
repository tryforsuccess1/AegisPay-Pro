import { TRON_SHASTA_USDT_CONTRACT } from "./tron-deposit-validation.ts";

type SettingsAdmin = {
  from: (table: string) => any;
};

export type ShastaTestRules = {
  network: "TRON TESTNET";
  token_contract: typeof TRON_SHASTA_USDT_CONTRACT;
  receiving_address: string;
};

const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TRON_MAINNET_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/** Require both isolated HD seed phrases to be configured and different. */
export function shastaMnemonicsAreDistinct(testHdMnemonic: string, mainnetHdMnemonic: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  const testSeed = normalize(testHdMnemonic);
  const mainnetSeed = normalize(mainnetHdMnemonic);
  return Boolean(testSeed && mainnetSeed && testSeed !== mainnetSeed);
}

export function shastaSecretsAreDistinct(
  testHdMnemonic: string,
  mainnetHdMnemonic: string,
  testPayoutPrivateKey: string,
  mainnetPayoutPrivateKey: string,
): boolean {
  const normalizeMnemonic = (value: string) => value.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  const testSeed = normalizeMnemonic(testHdMnemonic);
  const mainnetSeed = normalizeMnemonic(mainnetHdMnemonic);
  const testKey = testPayoutPrivateKey.trim().toLowerCase();
  const mainnetKey = mainnetPayoutPrivateKey.trim().toLowerCase();
  const reusedSeed = Boolean(testSeed && mainnetSeed && testSeed === mainnetSeed);
  const reusedSigner = Boolean(testKey && mainnetKey && testKey === mainnetKey);
  return !reusedSeed && !reusedSigner;
}

export function validShastaTestRules(value: unknown): value is ShastaTestRules {
  if (!value || typeof value !== "object") return false;
  const rules = value as Record<string, unknown>;
  return String(rules.network || "").toUpperCase() === "TRON TESTNET"
    && String(rules.token_contract || "").trim() === TRON_SHASTA_USDT_CONTRACT
    && TRON_ADDRESS_RE.test(String(rules.receiving_address || "").trim());
}

/**
 * Test mode is opt-in at the function secret AND the row-level allowlist.
 * Both conditions fail closed; user-supplied request fields cannot opt an
 * account into Shasta testing.
 */
export async function isAllowlistedShastaTestUser(
  admin: SettingsAdmin,
  userId: string,
  enabled: boolean,
): Promise<boolean> {
  if (!enabled || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return false;
  }
  const { data, error } = await admin.from("shasta_test_users")
    .select("user_id")
    .eq("user_id", userId)
    .eq("enabled", true)
    .maybeSingle();
  return !error && Boolean(data);
}

/**
 * Separate Shasta configuration is permitted only while all real-money gates
 * remain closed. It does not read or override the live deposit_rules setting.
 */
export async function loadShastaTestRules(
  admin: SettingsAdmin,
  enabled: boolean,
): Promise<ShastaTestRules | null> {
  if (!enabled) return null;
  const [
    { data: rulesRow, error: rulesError },
    { data: modeRow, error: modeError },
    { data: productionRow, error: productionError },
    { data: mainnetRow, error: mainnetError },
  ] = await Promise.all([
    admin.from("platform_settings").select("value_json").eq("key", "shasta_testnet_rules").maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle(),
  ]);
  if (rulesError || modeError || productionError || mainnetError || !rulesRow?.value_json || !modeRow?.value_json || !productionRow?.value_json || !mainnetRow?.value_json) return null;
  const mode = modeRow.value_json;
  const production = productionRow.value_json;
  const mainnet = mainnetRow.value_json;
  const paymentGatesSafelyClosed =
    String(mode.mode || "").toUpperCase() === "MAINNET"
    && mode.live_deposits === false
    && mode.real_payouts === false
    && mode.production_go_live_approved === false
    && String(production.environment || "").toUpperCase() === "PRE_PRODUCTION"
    && production.live_deposits_enabled === false
    && production.real_payouts_enabled === false
    && production.go_live_approved === false
    && production.payouts_locked === true;
  const distinctTreasuries =
    String(mainnet.network || "").toUpperCase() === "TRON MAINNET"
    && String(mainnet.token_contract || "").trim() === TRON_MAINNET_USDT_CONTRACT
    && TRON_ADDRESS_RE.test(String(mainnet.receiving_address || "").trim())
    && String(mainnet.receiving_address).trim() !== String(rulesRow.value_json.receiving_address || "").trim();
  if (!paymentGatesSafelyClosed || !validShastaTestRules(rulesRow.value_json) || !distinctTreasuries) return null;
  return rulesRow.value_json as ShastaTestRules;
}

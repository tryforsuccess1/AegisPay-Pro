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
  ] = await Promise.all([
    admin.from("platform_settings").select("value_json").eq("key", "shasta_testnet_rules").maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
    admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
  ]);
  if (rulesError || modeError || productionError || !rulesRow?.value_json || !modeRow?.value_json || !productionRow?.value_json) return null;
  const mode = modeRow.value_json;
  const production = productionRow.value_json;
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
  if (!paymentGatesSafelyClosed || !validShastaTestRules(rulesRow.value_json)) return null;
  return rulesRow.value_json as ShastaTestRules;
}

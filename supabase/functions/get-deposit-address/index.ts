import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TronWeb } from "npm:tronweb@6.0.4";
import { deriveTronHdIdentity } from "../_shared/tron-hd-wallet.ts";
import { isAllowlistedShastaTestUser, loadShastaTestRules, shastaSecretsAreDistinct } from "../_shared/shasta-test-mode.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const HD_MNEMONIC = Deno.env.get("TRON_HD_WALLET_MNEMONIC") || "";
const HD_PASSPHRASE = Deno.env.get("TRON_HD_WALLET_PASSPHRASE") || "";
const TESTNET_HD_MNEMONIC = Deno.env.get("TRON_TESTNET_HD_WALLET_MNEMONIC") || "";
const TESTNET_HD_PASSPHRASE = Deno.env.get("TRON_TESTNET_HD_WALLET_PASSPHRASE") || "";
const SHASTA_TEST_MODE_ENABLED = Deno.env.get("AEGIS_SHASTA_TEST_MODE") === "true";
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY") || "";
const CRON_SECRET = Deno.env.get("AEGIS_CRON_SECRET") || "";
const MAINNET_PAYOUT_KEY = Deno.env.get("TRON_PAYOUT_PRIVATE_KEY") || "";
const TESTNET_PAYOUT_KEY = Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY") || "";
const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "";
const TELEGRAM_APPROVER_IDS = (Deno.env.get("TELEGRAM_APPROVER_IDS") || "").split(/[\s,]+/).filter((v) => /^[0-9]{1,20}$/.test(v));
const MAINNET_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SHASTA_USDT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors }); }
function validAddress(value: string) { return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Deposit-address service is not configured." }, 503);
  try {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Authentication is required." }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authResult, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !authResult.user) return json({ error: "Invalid authentication token." }, 401);

    const { data: profile, error: profileError } = await admin.from("users").select("id,auth_user_id,role,status,frozen_until").eq("auth_user_id", authResult.user.id).maybeSingle();
    if (profileError || !profile) return json({ error: "AegisPay profile not found." }, 404);
    if (profile.role !== "USER" || !["ACTIVE","NORMAL"].includes(String(profile.status || "").toUpperCase())) return json({ error: "This account cannot create a deposit address." }, 403);
    if (profile.frozen_until && new Date(profile.frozen_until).getTime() > Date.now()) return json({ error: "This account is temporarily frozen for security." }, 423);

    const isShastaTestUser = await isAllowlistedShastaTestUser(admin, profile.id, SHASTA_TEST_MODE_ENABLED);
    const testnetRules = isShastaTestUser
      ? await loadShastaTestRules(admin, SHASTA_TEST_MODE_ENABLED)
      : null;
    if (isShastaTestUser && !testnetRules) return json({ error: "Shasta test mode is unavailable while live-money gates are open or its test configuration is invalid.", code: "SHASTA_TEST_MODE_BLOCKED" }, 423);

    const [{ data: runtimeEnabled, error: runtimeError }, { data: rulesRow, error: rulesError },
      { data: modeRow, error: modeError }, { data: productionRow, error: productionError }] = await Promise.all([
      admin.rpc("app_runtime_enabled"),
      admin.from("platform_settings").select("value_json").eq("key", isShastaTestUser ? "shasta_testnet_rules" : "deposit_rules").maybeSingle(),
      admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
      admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
    ]);
    if (runtimeError || rulesError || modeError || productionError || !rulesRow?.value_json || !modeRow?.value_json || !productionRow?.value_json) return json({ error: "Unable to confirm deposit-network readiness." }, 503);
    if (runtimeEnabled !== true) return json({ error: "AegisPay is paused by Master Admin." }, 423);

    const rules = isShastaTestUser ? testnetRules! : rulesRow.value_json;
    const mode = modeRow.value_json, production = productionRow.value_json;
    const network = String(rules.network || "").toUpperCase();
    const tokenContract = String(rules.token_contract || "").trim();
    const treasury = String(rules.receiving_address || "").trim();
    const hdMnemonic = isShastaTestUser ? TESTNET_HD_MNEMONIC : HD_MNEMONIC;
    const hdPassphrase = isShastaTestUser ? TESTNET_HD_PASSPHRASE : HD_PASSPHRASE;
    let ready = false, payoutKey = "";
    if (network === "TRON MAINNET") {
      payoutKey = MAINNET_PAYOUT_KEY;
      const credentialsReady = Boolean(TRONGRID_KEY && CRON_SECRET && MAINNET_PAYOUT_KEY && TELEGRAM_TOKEN && TELEGRAM_CHAT_ID && TELEGRAM_APPROVER_IDS.length > 0);
      const { data: unresolved, error: unresolvedError } = await admin.from("withdrawal_requests").select("id").in("status", ["APPROVED","PROCESSING"]).is("payout_txid", null).limit(1);
      if (unresolvedError) return json({ error: "Unable to confirm payout reconciliation status." }, 503);
      ready = tokenContract === MAINNET_USDT && mode.mode === "MAINNET" && mode.live_deposits === true
        && mode.real_payouts === true && mode.production_go_live_approved === true
        && String(production.environment || "").toUpperCase() === "PRODUCTION"
        && production.live_deposits_enabled === true && production.real_payouts_enabled === true
        && production.go_live_approved === true && production.payouts_locked === false
        && credentialsReady && (unresolved || []).length === 0;
    } else if (network === "TRON TESTNET") {
      payoutKey = TESTNET_PAYOUT_KEY;
      ready = isShastaTestUser && Boolean(testnetRules) && tokenContract === SHASTA_USDT
        && mode.mode === "MAINNET" && mode.live_deposits === false && mode.real_payouts === false
        && mode.production_go_live_approved === false
        && String(production.environment || "").toUpperCase() === "PRE_PRODUCTION"
        && production.live_deposits_enabled === false && production.real_payouts_enabled === false
        && production.go_live_approved === false && production.payouts_locked === true;
    } else return json({ error: "Unsupported deposit network." }, 503);

    if (!ready) return json({ error: "Deposit addresses are unavailable until the selected network and payout-readiness checks pass.", code: "DEPOSIT_ADDRESS_NETWORK_PAUSED" }, 423);
    if (network === "TRON TESTNET" && !shastaSecretsAreDistinct(
      TESTNET_HD_MNEMONIC, HD_MNEMONIC, TESTNET_PAYOUT_KEY, MAINNET_PAYOUT_KEY,
    )) {
      return json({ error: "All four Shasta/Mainnet HD and payout secrets must be present and distinct.", code: "TESTNET_SECRET_REUSE_BLOCKED" }, 423);
    }
    if (!validAddress(treasury) || !payoutKey || String(TronWeb.address.fromPrivateKey(payoutKey) || "") !== treasury) {
      return json({ error: "The configured treasury address does not match the authorized payout signer. No deposit address was issued.", code: "TREASURY_SIGNER_MISMATCH" }, 409);
    }
    if (!hdMnemonic.trim()) return json({ error: "The dedicated TRON HD wallet secret is not configured. No deposit address was issued.", code: "HD_WALLET_NOT_CONFIGURED" }, 503);

    const rootIdentity = await deriveTronHdIdentity(hdMnemonic, hdPassphrase, 0);
    const rootFingerprint = rootIdentity.rootFingerprint;
    const { data: current, error: currentError } = await admin.from("deposit_wallets").select("id,address,network,derivation_index,wallet_root_fingerprint,token_contract,status")
      .eq("user_id", profile.id).eq("network", network).eq("status", "ACTIVE").maybeSingle();
    if (currentError) return json({ error: "Unable to load the assigned deposit address." }, 503);
    if (current) {
      if (current.wallet_root_fingerprint !== rootFingerprint) return json({ error: "The configured HD root does not match this user's existing address record. Restore the original root secret before issuing addresses.", code: "HD_WALLET_ROOT_MISMATCH" }, 409);
      return json({ address: current.address, network, tokenContract: current.token_contract, derivationPath: `m/44'/195'/0'/0/${current.derivation_index}`, created: false });
    }

    const { data: nextIndex, error: indexError } = await admin.rpc("next_tron_deposit_address_index");
    const index = Number(nextIndex);
    if (indexError || !Number.isSafeInteger(index) || index < 1 || index >= 2147483648) return json({ error: "Unable to allocate a secure deposit-address index." }, 503);
    const identity = await deriveTronHdIdentity(hdMnemonic, hdPassphrase, index);
    if (identity.rootFingerprint !== rootFingerprint || !validAddress(identity.address)) return json({ error: "HD wallet derivation validation failed." }, 503);

    const { data: inserted, error: insertError } = await admin.from("deposit_wallets").insert({
      user_id: profile.id, network, address: identity.address, derivation_index: index,
      wallet_root_fingerprint: rootFingerprint, token_contract: tokenContract, status: "ACTIVE",
    }).select("id,address,network,derivation_index,wallet_root_fingerprint,token_contract").single();
    if (insertError || !inserted) {
      const { data: raced } = await admin.from("deposit_wallets").select("address,network,derivation_index,wallet_root_fingerprint,token_contract,status")
        .eq("user_id", profile.id).eq("network", network).eq("status", "ACTIVE").maybeSingle();
      if (raced && raced.wallet_root_fingerprint === rootFingerprint) return json({ address: raced.address, network, tokenContract: raced.token_contract, derivationPath: `m/44'/195'/0'/0/${raced.derivation_index}`, created: false });
      return json({ error: "Unable to safely assign a unique deposit address." }, 409);
    }
    await admin.from("audit_events").insert({ actor_user_id: profile.id, target_user_id: profile.id, event_type: "DEPOSIT_ADDRESS_ASSIGNED", description: "Assigned a unique TRON HD deposit address.", reference_id: inserted.id });
    return json({ address: inserted.address, network, tokenContract: inserted.token_contract, derivationPath: identity.derivationPath, created: true });
  } catch {
    return json({ error: "Unable to create or load the deposit address. No funds were moved." }, 500);
  }
});

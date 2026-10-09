import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY");
const MAINNET_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SHASTA_TEST_USDT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Deposit service is not configured." }, 503);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid authentication token." }, 401);
    const { data: appEnabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (appEnabled !== true) return json({ error: "AegisPay is paused by Master Admin." }, 423);
    const { data: profile } = await admin.from("users")
      .select("id,auth_user_id,role,status").eq("auth_user_id", auth.user.id).maybeSingle();
    if (!profile || !["USER","MASTER ADMIN"].includes(profile.role)) return json({ error: "AegisPay profile not found." }, 404);
    if (["BLOCKED","SUSPENDED","DELETED"].includes(String(profile.status).toUpperCase())) {
      return json({ error: "This account cannot verify deposits." }, 403);
    }

    const body = await req.json().catch(() => null);
    const depositId = typeof body?.depositId === "string" ? body.depositId : "";
    if (!depositId) return json({ error: "depositId is required." }, 400);
    let depositQuery = admin.from("deposit_submissions").select("*").eq("id", depositId);
    if (profile.role !== "MASTER ADMIN") depositQuery = depositQuery.eq("user_id", profile.id);
    const { data: deposit, error: depError } = await depositQuery.maybeSingle();
    if (depError || !deposit) return json({ error: "Deposit not found." }, 404);
    if (deposit.status !== "PENDING_VERIFICATION") return json({ status: deposit.status });
    if (!deposit.screenshot_path || !["APPROVED","MANUAL_APPROVED"].includes(deposit.ai_review_status)) {
      return json({
        status: "PENDING_VERIFICATION",
        message: "Deposit evidence has not passed review. No balance has been credited.",
      }, 202);
    }

    const { data: settingsRow } = await admin.from("platform_settings")
      .select("value_json").eq("key", "deposit_rules").maybeSingle();
    const rules = settingsRow?.value_json || {};
    const network = String(rules.network || "").toUpperCase();
    const receiving = String(rules.receiving_address || "").trim();
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(receiving)) {
      return json({ error: "A valid TRON receiving address is not configured." }, 503);
    }

    let baseUrl = "";
    let contract = "";
    if (network === "TRON TESTNET") {
      baseUrl = "https://api.shasta.trongrid.io";
      contract = String(rules.token_contract || SHASTA_TEST_USDT).trim();
    } else if (network === "TRON MAINNET") {
      const { data: modeRow } = await admin.from("platform_settings")
        .select("value_json").eq("key", "system_mode").maybeSingle();
      const mode = modeRow?.value_json || {};
      if (mode.mode !== "MAINNET" || mode.live_deposits !== true) {
        return json({ error: "Mainnet deposits are disabled while live deposits are off." }, 403);
      }
      if (!TRONGRID_KEY) return json({ error: "TRONGRID_API_KEY is not configured." }, 503);
      baseUrl = "https://api.trongrid.io";
      contract = String(rules.token_contract || MAINNET_USDT).trim();
    } else {
      return json({ error: "Select a supported TRON network in deposit settings." }, 503);
    }
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(contract)) {
      return json({ error: "A valid TRC-20 token contract is not configured." }, 503);
    }

    const url = new URL(baseUrl + "/v1/accounts/" + encodeURIComponent(receiving) + "/transactions/trc20");
    url.searchParams.set("only_confirmed", "true");
    url.searchParams.set("only_to", "true");
    url.searchParams.set("limit", "200");
    url.searchParams.set("contract_address", contract);
    const headers: Record<string, string> = { accept: "application/json" };
    if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
    const chainRes = await fetch(url, { headers });
    if (!chainRes.ok) return json({ error: "TRON verification service returned " + chainRes.status + "." }, 502);
    const chain = await chainRes.json();
    const transfers = Array.isArray(chain.data) ? chain.data : [];
    const match = transfers.find((x: any) =>
      String(x.transaction_id).toLowerCase() === String(deposit.txid).toLowerCase()
      && String(x.to) === receiving
      && String(x.token_info?.address || contract) === contract
      && String(x.type || "Transfer") === "Transfer"
      && x.success !== false
    );
    if (!match) return json({ status: "PENDING_VERIFICATION", message: "No matching confirmed transfer found yet." }, 202);

    const decimals = Number(match.token_info?.decimals ?? 6);
    const raw = String(match.value || "0");
    const chainAmount = Number(raw) / Math.pow(10, decimals);
    const requestedAmount = Number(deposit.gross_amount);
    if (!Number.isFinite(chainAmount) || Math.abs(chainAmount - requestedAmount) > 0.000001) {
      return json({ error: "On-chain amount does not match the submitted deposit amount." }, 409);
    }

    const { data: applied, error: applyError } = await admin.rpc("apply_verified_deposit", {
      p_deposit_id: deposit.id,
      p_sender_address: String(match.from || ""),
      p_raw_amount: raw,
      p_block_timestamp: match.block_timestamp ? new Date(Number(match.block_timestamp)).toISOString() : null,
      p_verification_source: "TronGrid",
    });
    if (applyError) return json({ error: applyError.message }, 500);
    return json({ status: "VERIFIED", deposit: applied, txid: match.transaction_id, amount: chainAmount });
  } catch {
    return json({ error: "Unable to verify deposit." }, 500);
  }
});

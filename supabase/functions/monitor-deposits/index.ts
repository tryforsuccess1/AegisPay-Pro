import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY");
const CRON_SECRET = Deno.env.get("AEGIS_CRON_SECRET");
const MAINNET_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SHASTA_TEST_USDT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function verifyOne(admin: any, deposit: any, receiving: string, baseUrl: string, contract: string) {
  const url = new URL(baseUrl + "/v1/accounts/" + encodeURIComponent(receiving) + "/transactions/trc20");
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("only_to", "true");
  url.searchParams.set("limit", "200");
  url.searchParams.set("contract_address", contract);
  const headers: Record<string, string> = { accept: "application/json" };
  if (TRONGRID_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_KEY;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("TronGrid " + response.status);
  const payload = await response.json();
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const match = rows.find((x: any) =>
    String(x.transaction_id).toLowerCase() === String(deposit.txid).toLowerCase()
    && String(x.to) === receiving
    && String(x.token_info?.address || contract) === contract
    && x.success !== false
  );
  if (!match) return { id: deposit.id, status: "PENDING" };

  const decimals = Number(match.token_info?.decimals ?? 6);
  const raw = String(match.value || "0");
  const amount = Number(raw) / Math.pow(10, decimals);
  if (Math.abs(amount - Number(deposit.gross_amount)) > 0.000001) {
    return { id: deposit.id, status: "AMOUNT_MISMATCH" };
  }
  const { error } = await admin.rpc("apply_verified_deposit", {
    p_deposit_id: deposit.id,
    p_sender_address: String(match.from || ""),
    p_raw_amount: raw,
    p_block_timestamp: match.block_timestamp ? new Date(Number(match.block_timestamp)).toISOString() : null,
    p_verification_source: "TronGrid Monitor",
  });
  return { id: deposit.id, status: error ? "ERROR" : "VERIFIED" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!CRON_SECRET || req.headers.get("x-aegis-cron-secret") !== CRON_SECRET) return json({ error: "Unauthorized." }, 401);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Deposit monitor is not configured." }, 503);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: appEnabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (appEnabled !== true) return json({ appEnabled: false, checked: 0, results: [] });
    const { data: rulesRow } = await admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle();
    const rules = rulesRow?.value_json || {};
    const network = String(rules.network || "").toUpperCase();
    const receiving = String(rules.receiving_address || "").trim();
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(receiving)) return json({ error: "Valid receiving address is not configured." }, 503);

    let baseUrl = "";
    let contract = "";
    if (network === "TRON TESTNET") {
      baseUrl = "https://api.shasta.trongrid.io";
      contract = String(rules.token_contract || SHASTA_TEST_USDT).trim();
    } else if (network === "TRON MAINNET") {
      const { data: modeRow } = await admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle();
      const mode = modeRow?.value_json || {};
      if (mode.mode !== "MAINNET" || mode.live_deposits !== true) {
        return json({ error: "Mainnet deposit monitoring is disabled while live deposits are off." }, 403);
      }
      if (!TRONGRID_KEY) return json({ error: "TRONGRID_API_KEY is not configured." }, 503);
      baseUrl = "https://api.trongrid.io";
      contract = String(rules.token_contract || MAINNET_USDT).trim();
    } else {
      return json({ error: "Unsupported TRON network." }, 503);
    }
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(contract)) return json({ error: "Valid TRC-20 contract is not configured." }, 503);

    const { data: pending, error } = await admin.from("deposit_submissions").select("*")
      .eq("status", "PENDING_VERIFICATION")
      .in("ai_review_status", ["APPROVED","MANUAL_APPROVED"])
      .order("created_at", { ascending: true }).limit(100);
    if (error) return json({ error: "Unable to load pending deposits." }, 500);
    const results = [];
    for (const deposit of pending || []) {
      try {
        results.push(await verifyOne(admin, deposit, receiving, baseUrl, contract));
      } catch {
        results.push({ id: deposit.id, status: "ERROR" });
      }
    }
    return json({ checked: results.length, results });
  } catch {
    return json({ error: "Deposit monitor failed." }, 500);
  }
});

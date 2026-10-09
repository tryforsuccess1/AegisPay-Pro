import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TronWeb } from "npm:tronweb@6.0.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MAINNET_PAYOUT_KEY = Deno.env.get("TRON_PAYOUT_PRIVATE_KEY");
const TESTNET_PAYOUT_KEY = Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY");
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY");
const MAINNET_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SHASTA_USDT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function errorMessage(error: unknown) {
  return String((error as Error)?.message || error).slice(0, 500);
}

function usdtUnits(value: unknown) {
  const decimal = String(value ?? "");
  if (!/^\d+(?:\.\d{1,6})?$/.test(decimal)) {
    throw new Error("Withdrawal net amount is invalid.");
  }

  const [whole, fraction = ""] = decimal.split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (units <= 0n) throw new Error("Withdrawal net amount must be greater than zero.");
  return units.toString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

let admin: ReturnType<typeof createClient> | null = null;
let withdrawalId: string | null = null;
let claimedWithdrawal: any = null;
let payoutMayHaveBeenBroadcast = false;

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Payout service is not configured." }, 503);
    }
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);

    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authResult, error: authError } = await admin.auth.getUser(token);
    if (authError || !authResult.user) return json({ error: "Invalid authentication token." }, 401);

    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("id,role,status")
      .eq("auth_user_id", authResult.user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "AegisPay profile not found." }, 404);
    if (profile.role !== "MASTER ADMIN") {
      return json({ error: "Master Admin access required." }, 403);
    }
    if (!["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
      return json({ error: "Active Master Admin access is required." }, 403);
    }
    const { data: appEnabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (appEnabled !== true) return json({ error: "AegisPay is paused by Master Admin." }, 423);

    const { data: modeRow } = await admin.from("platform_settings")
      .select("value_json").eq("key", "system_mode").maybeSingle();
    const systemMode = modeRow?.value_json || {};
    const { data: networkRow } = await admin.from("platform_settings")
      .select("value_json").eq("key", "deposit_rules").maybeSingle();
    const network = String(networkRow?.value_json?.network || "").toUpperCase();

    const { data: productionRow, error: productionError } = await admin.from("platform_settings")
      .select("value_json").eq("key", "production_config").maybeSingle();
    if (productionError) return json({ error: "Unable to confirm production payout gate." }, 503);
    const productionConfig = productionRow?.value_json || {};

    const testnet = systemMode.mode === "TESTNET_DEMO" && systemMode.testnet_payouts === true && network === "TRON TESTNET";
    const mainnet = systemMode.mode === "MAINNET"
      && systemMode.real_payouts === true
      && systemMode.production_go_live_approved === true
      && network === "TRON MAINNET"
      && productionConfig.go_live_approved === true
      && productionConfig.real_payouts_enabled === true
      && productionConfig.payouts_locked === false
      && String(productionConfig.environment || "").toUpperCase() === "PRODUCTION";

    if (systemMode.mode === "MAINNET" && network === "TRON MAINNET" && systemMode.real_payouts === true && !mainnet) {
      return json({ error: "Production payout gate is locked. Complete the Phase 3 go-live checks before enabling real payouts." }, 403);
    }
    if (!testnet && !mainnet) return json({ error: "The selected TRON network is not enabled for payouts." }, 403);
    const payoutKey = testnet ? TESTNET_PAYOUT_KEY : MAINNET_PAYOUT_KEY;
    if (!payoutKey) return json({ error: testnet ? "TRON_TESTNET_PAYOUT_PRIVATE_KEY is not configured." : "TRON_PAYOUT_PRIVATE_KEY is not configured." }, 503);
    const tokenContract = String(networkRow?.value_json?.token_contract || "");
    if (testnet && tokenContract !== SHASTA_USDT) return json({ error: "The testnet USDT contract does not match the supported Shasta token." }, 403);
    if (mainnet && tokenContract && tokenContract !== MAINNET_USDT) return json({ error: "The configured token is not the supported TRON mainnet USDT contract." }, 403);
    const chain = testnet ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io";
    const usdtContract = testnet ? SHASTA_USDT : MAINNET_USDT;

    const body = await req.json().catch(() => null);
    withdrawalId = typeof body?.withdrawalId === "string" ? body.withdrawalId : null;
    if (!withdrawalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(withdrawalId)) {
      return json({ error: "A valid withdrawalId is required." }, 400);
    }

    // Atomic claim: only one invocation can transition an approved request to PROCESSING.
    const { data: withdrawal, error: claimError } = await admin
      .from("withdrawal_requests")
      .update({
        status: "PROCESSING",
        payout_started_at: new Date().toISOString(),
        payout_error: null,
      })
      .eq("id", withdrawalId)
      .eq("status", "APPROVED")
      .eq("panel_decision", "APPROVED")
      .eq("telegram_decision", "APPROVED")
      .is("payout_txid", null)
      .select("id,user_id,net_amount,destination_address,panel_decision,telegram_decision")
      .maybeSingle();

    if (claimError) return json({ error: "Unable to lock the approved withdrawal." }, 500);
    if (!withdrawal) {
      return json({ error: "Withdrawal is unavailable or has already been claimed." }, 409);
    }
    claimedWithdrawal = withdrawal;

    if (testnet) {
      const { data: currentMode, error: currentModeError } = await admin.from("platform_settings")
        .select("value_json").eq("key", "system_mode").maybeSingle();
      if (currentModeError || currentMode?.value_json?.mode !== "TESTNET_DEMO" || currentMode?.value_json?.testnet_payouts !== true) {
        throw new Error("Testnet payouts were disabled before the transfer could be broadcast.");
      }
    }

    const amountRaw = usdtUnits(withdrawal.net_amount);
    if (!withdrawal.destination_address) {
      throw new Error("Withdrawal destination address is missing.");
    }

    const tron = new TronWeb({
      fullHost: chain,
      headers: TRONGRID_KEY ? { "TRON-PRO-API-KEY": TRONGRID_KEY } : undefined,
      privateKey: payoutKey,
    });
    const contract = await tron.contract().at(usdtContract);

    // Recheck the complete production gate immediately before network broadcast.
    // This closes the race where an operator locks production after the request is claimed
    // but before the transfer is submitted. Any failed gate exits through the safe refund path.
    if (mainnet) {
      const [{ data: finalModeRow, error: finalModeError },
        { data: finalNetworkRow, error: finalNetworkError },
        { data: finalProductionRow, error: finalProductionError },
        { data: finalRuntimeRow, error: finalRuntimeError }] = await Promise.all([
          admin.from("platform_settings").select("value_json").eq("key", "system_mode").maybeSingle(),
          admin.from("platform_settings").select("value_json").eq("key", "deposit_rules").maybeSingle(),
          admin.from("platform_settings").select("value_json").eq("key", "production_config").maybeSingle(),
          admin.from("platform_settings").select("value_json").eq("key", "app_runtime").maybeSingle(),
        ]);
      if (finalModeError || finalNetworkError || finalProductionError || finalRuntimeError) {
        throw new Error("Unable to revalidate the production payout gate.");
      }
      const finalSystem = finalModeRow?.value_json || {};
      const finalNetworkConfig = finalNetworkRow?.value_json || {};
      const finalProduction = finalProductionRow?.value_json || {};
      const finalNetwork = String(finalNetworkConfig.network || "").toUpperCase();
      const finalRuntimeEnabled = finalRuntimeRow?.value_json?.enabled === true;
      const finalGateOpen =
        finalSystem.mode === "MAINNET" &&
        finalSystem.real_payouts === true &&
        finalSystem.production_go_live_approved === true &&
        finalNetwork === "TRON MAINNET" &&
        String(finalProduction.environment || "").toUpperCase() === "PRODUCTION" &&
        finalProduction.go_live_approved === true &&
        finalProduction.real_payouts_enabled === true &&
        finalProduction.payouts_locked === false &&
        finalRuntimeEnabled === true;
      if (!finalGateOpen) {
        throw new Error("Production payout gate was closed before broadcast.");
      }
    } else {
      const { data: stillEnabled, error: finalRuntimeError } = await admin.rpc("app_runtime_enabled");
      if (finalRuntimeError || stillEnabled !== true) {
        throw new Error("AegisPay is paused by Master Admin; payout was not broadcast.");
      }
    }

    // From this point onward a transport error can mean the chain accepted the transfer.
    // Keep the row PROCESSING on any uncertain outcome so it cannot be paid a second time.
    payoutMayHaveBeenBroadcast = true;
    const txid = String(await contract.transfer(withdrawal.destination_address, amountRaw).send({
      feeLimit: 100_000_000,
      callValue: 0,
      shouldPollResponse: true,
    }));
    if (!txid || txid === "undefined" || txid === "null") {
      throw new Error("TRON returned no transaction id.");
    }

    const { data: paid, error: persistError } = await admin
      .from("withdrawal_requests")
      .update({
        status: "PAID",
        payout_txid: txid,
        payout_completed_at: new Date().toISOString(),
        payout_error: null,
      })
      .eq("id", withdrawal.id)
      .eq("status", "PROCESSING")
      .select("id")
      .maybeSingle();

    if (persistError || !paid) {
      await admin.from("withdrawal_requests")
        .update({ payout_error: "TRON transaction " + txid + " was submitted; payout status needs manual reconciliation." })
        .eq("id", withdrawal.id)
        .eq("status", "PROCESSING");
      return json({
        status: "RECONCILIATION_REQUIRED",
        txid,
        error: "The transfer was submitted, but its status could not be saved. Do not retry before reconciliation.",
      }, 202);
    }

    const { error: auditError } = await admin.from("audit_events").insert({
      actor_user_id: profile.id,
      target_user_id: withdrawal.user_id,
      event_type: "WITHDRAWAL_PAID",
      description: "TRON USDT payout submitted by payout service",
      reference_id: withdrawal.id,
    });

    return json({ status: "PAID", txid, auditLogged: !auditError });
  } catch (error) {
    const detail = errorMessage(error);
    if (admin && withdrawalId) {
      if (payoutMayHaveBeenBroadcast) {
        await admin.from("withdrawal_requests")
          .update({ payout_error: "Payout outcome is unknown; keep PROCESSING until chain reconciliation. " + detail })
          .eq("id", withdrawalId)
          .eq("status", "PROCESSING");
      } else if (claimedWithdrawal) {
        const { data: restored, error: restoreError } = await admin.rpc("fail_unbroadcast_withdrawal", {
          p_request_id: withdrawalId,
          p_error: "Payout was not broadcast. " + detail,
        });
        if (restoreError || restored !== true) {
          await admin.from("withdrawal_requests")
            .update({ payout_error: "Payout was not broadcast, but the balance refund needs manual reconciliation. " + detail })
            .eq("id", withdrawalId)
            .eq("status", "PROCESSING");
        }
      } else {
        await admin.from("withdrawal_requests")
          .update({ payout_error: "Payout was not submitted." })
          .eq("id", withdrawalId)
          .eq("status", "APPROVED");
      }
    }
    if (detail.includes("AegisPay is paused by Master Admin")) {
      return json({
        error: "AegisPay is paused by Master Admin.",
        balanceRestored: Boolean(claimedWithdrawal && !payoutMayHaveBeenBroadcast),
      }, 423);
    }
    return json({
      error: payoutMayHaveBeenBroadcast
        ? "Payout outcome is unknown; keep the withdrawal locked for manual reconciliation."
        : claimedWithdrawal
        ? "Payout failed before broadcast. The balance was restored or flagged for manual refund reconciliation."
        : "Payout request failed before broadcast.",
      balanceRestored: Boolean(claimedWithdrawal && !payoutMayHaveBeenBroadcast),
      detail,
    }, payoutMayHaveBeenBroadcast || claimedWithdrawal ? 202 : 502);
  }
});


import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = "private-verification";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
async function signedUrl(admin: any, path: string | null) {
  if (!path) return null;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
  return error ? null : data?.signedUrl || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Admin review service is not configured." }, 503);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid authentication token." }, 401);
    const { data: actor } = await admin.from("users").select("id,role,status")
      .eq("auth_user_id", auth.user.id).maybeSingle();
    if (!actor || actor.role !== "MASTER ADMIN" || ["BLOCKED","SUSPENDED","DELETED"].includes(String(actor.status).toUpperCase())) {
      return json({ error: "Master Admin access required." }, 403);
    }
    const { data: stats, error: statsError } = await admin.rpc("aegispay_admin_dashboard_totals", {
      p_admin_auth_user_id: auth.user.id,
    });
    if (statsError) return json({ error: "Unable to load confirmed platform totals." }, 500);
    const { data: appEnabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    const [depositResult, kycResult, withdrawalResult, depositHistoryResult, kycHistoryResult] = await Promise.all([
      admin.from("deposit_submissions")
        .select("id,user_id,tier_id,gross_amount,credited_amount,txid,status,ai_review_status,ai_review_reason,ai_confidence,ai_checks,ai_policy_version,verification_note,screenshot_path,created_at")
        .eq("status", "PENDING_VERIFICATION").order("created_at", { ascending: true }).limit(50),
      admin.from("kyc_verifications")
        .select("id,user_id,document_type,status,ai_review_status,ai_confidence,ai_checks,ai_policy_version,review_reason,front_storage_path,back_storage_path,submitted_at")
        .in("status", ["PENDING_REVIEW","MANUAL_REVIEW"]).order("submitted_at", { ascending: true }).limit(50),
      admin.from("withdrawal_requests")
        .select("id,user_id,amount,fee_amount,net_amount,destination_address,status,created_at,payout_error,payout_txid,panel_decision,panel_decided_at,telegram_decision,telegram_decided_at,telegram_status,telegram_message_id")
        .in("status", ["PENDING_APPROVAL","APPROVED"]).order("created_at", { ascending: true }).limit(50),
      admin.from("deposit_submissions")
        .select("id,user_id,tier_id,gross_amount,credited_amount,txid,status,ai_review_status,ai_review_reason,ai_confidence,ai_checks,ai_policy_version,verification_note,screenshot_path,created_at")
        .neq("status", "PENDING_VERIFICATION").order("created_at", { ascending: false }).limit(100),
      admin.from("kyc_verifications")
        .select("id,user_id,document_type,status,ai_review_status,ai_confidence,ai_checks,ai_policy_version,review_reason,front_storage_path,back_storage_path,submitted_at")
        .not("status", "in", '("PENDING_REVIEW","MANUAL_REVIEW")').order("submitted_at", { ascending: false }).limit(100),
    ]);
    if (depositResult.error || kycResult.error || withdrawalResult.error || depositHistoryResult.error || kycHistoryResult.error) {
      return json({ error: "Unable to load review queues." }, 500);
    }

    const deposits = depositResult.data || [];
    const kyc = kycResult.data || [];
    const withdrawals = withdrawalResult.data || [];
    const depositHistory = depositHistoryResult.data || [];
    const kycHistory = kycHistoryResult.data || [];
    const userIds = Array.from(new Set([
      ...deposits.map((x: any) => x.user_id),
      ...kyc.map((x: any) => x.user_id),
      ...withdrawals.map((x: any) => x.user_id),
      ...depositHistory.map((x: any) => x.user_id),
      ...kycHistory.map((x: any) => x.user_id),
    ]));
    const usersResult = userIds.length
      ? await admin.from("users").select("id,name,email").in("id", userIds)
      : { data: [], error: null };
    if (usersResult.error) return json({ error: "Unable to load account labels." }, 500);
    const users = new Map((usersResult.data || []).map((x: any) => [x.id, { name: x.name, email: x.email }]));

    return json({
      deposits: await Promise.all(deposits.map(async (x: any) => ({
        id: x.id, tierId: x.tier_id, grossAmount: x.gross_amount, creditedAmount: x.credited_amount,
        txid: x.txid, status: x.status, aiReviewStatus: x.ai_review_status,
        aiReviewReason: x.ai_review_reason, aiConfidence: x.ai_confidence, aiChecks: x.ai_checks || {}, aiPolicyVersion: x.ai_policy_version, note: x.verification_note, submittedAt: x.created_at,
        user: users.get(x.user_id) || null, screenshotUrl: await signedUrl(admin, x.screenshot_path),
      }))),
      depositHistory: await Promise.all(depositHistory.map(async (x: any) => ({
        id: x.id, tierId: x.tier_id, grossAmount: x.gross_amount, creditedAmount: x.credited_amount,
        txid: x.txid, status: x.status, aiReviewStatus: x.ai_review_status,
        aiReviewReason: x.ai_review_reason, aiConfidence: x.ai_confidence, aiChecks: x.ai_checks || {}, aiPolicyVersion: x.ai_policy_version, note: x.verification_note, submittedAt: x.created_at,
        user: users.get(x.user_id) || null, screenshotUrl: await signedUrl(admin, x.screenshot_path),
      }))),
      kyc: await Promise.all(kyc.map(async (x: any) => ({
        id: x.id, documentType: x.document_type, status: x.status,
        aiReviewStatus: x.ai_review_status, confidence: x.ai_confidence, aiChecks: x.ai_checks || {}, aiPolicyVersion: x.ai_policy_version, reason: x.review_reason,
        submittedAt: x.submitted_at, user: users.get(x.user_id) || null,
        frontUrl: await signedUrl(admin, x.front_storage_path),
        backUrl: await signedUrl(admin, x.back_storage_path),
      }))),
      kycHistory: await Promise.all(kycHistory.map(async (x: any) => ({
        id: x.id, documentType: x.document_type, status: x.status,
        aiReviewStatus: x.ai_review_status, confidence: x.ai_confidence, aiChecks: x.ai_checks || {}, aiPolicyVersion: x.ai_policy_version, reason: x.review_reason,
        submittedAt: x.submitted_at, user: users.get(x.user_id) || null,
        frontUrl: await signedUrl(admin, x.front_storage_path),
        backUrl: await signedUrl(admin, x.back_storage_path),
      }))),
      withdrawals: withdrawals.map((x: any) => ({
        id: x.id, amount: x.amount, feeAmount: x.fee_amount, netAmount: x.net_amount,
        destinationAddress: x.destination_address, status: x.status, submittedAt: x.created_at,
        payoutError: x.payout_error, payoutTxid: x.payout_txid,
        panelDecision: x.panel_decision, panelDecidedAt: x.panel_decided_at,
        telegramDecision: x.telegram_decision, telegramDecidedAt: x.telegram_decided_at,
        telegramStatus: x.telegram_status, telegramMessageId: x.telegram_message_id,
        user: users.get(x.user_id) || null,
      })),
      stats,
      expiresInSeconds: 600,
    });
  } catch {
    return json({ error: "Unable to load review queues." }, 500);
  }
});


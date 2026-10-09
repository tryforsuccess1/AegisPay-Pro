import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadPrivateImage, runVisionReview } from "./ai-review.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const POLICY_VERSION = "2026-10-08-v1";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function reasonFor(result: Record<string, unknown>, confidence: number, configured: boolean) {
  if (!configured) return "AI_REVIEW_UNAVAILABLE";
  if (result.front_blurry === true || result.back_blurry === true) return "BLURRY_IMAGE";
  if (result.front_readable !== true || result.back_readable === false) return "DOCUMENT_UNREADABLE";
  if (result.document_type_matches === false) return "DOCUMENT_TYPE_MISMATCH";
  if (result.name_matches_profile === false) return "PROFILE_NAME_MISMATCH";
  if (Array.isArray(result.tamper_indicators) && result.tamper_indicators.length > 0) return "POTENTIAL_TAMPERING";
  if (confidence < 0.95) return "LOW_CONFIDENCE";
  return "MANUAL_REVIEW_REQUIRED";
}
function reasonMessage(reason: string, documentType: string) {
  const messages: Record<string, string> = {
    BLURRY_IMAGE: "Your " + documentType + " image is blurry. Please upload a sharp, well-lit photo with all text clearly readable.",
    DOCUMENT_UNREADABLE: "Your " + documentType + " image could not be read clearly. Please upload a complete, high-resolution image without cropping any edge.",
    DOCUMENT_TYPE_MISMATCH: "The uploaded document could not be confidently identified as the selected document type. Please upload the correct " + documentType + ".",
    PROFILE_NAME_MISMATCH: "The name on the uploaded document does not sufficiently match your AegisPay profile name. Please upload the correct document or contact support if your legal name has changed.",
    POTENTIAL_TAMPERING: "The document needs additional verification because the AI detected a possible authenticity or alteration concern.",
    LOW_CONFIDENCE: "The document review was inconclusive. Please upload clearer images with the full document visible.",
    AI_REVIEW_UNAVAILABLE: "The identity review service is temporarily unavailable. Please try again later.",
    MANUAL_REVIEW_REQUIRED: "Your document requires additional verification before it can be approved.",
  };
  return messages[reason] || messages.MANUAL_REVIEW_REQUIRED;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "KYC service is not configured." }, 503);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid authentication token." }, 401);
    const { data: aiSetting } = await admin.from("platform_settings").select("value_json").eq("key","ai_review").maybeSingle();
    const aiEnabled = aiSetting?.value_json?.enabled !== false;
    const { data: appEnabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (appEnabled !== true) return json({ error: "AegisPay is paused by Master Admin." }, 423);

    const { data: profile, error: profileError } = await admin.from("users")
      .select("id,auth_user_id,name,role,status").eq("auth_user_id", auth.user.id).maybeSingle();
    if (profileError || !profile) return json({ error: "AegisPay profile not found." }, 404);
    if (profile.role !== "USER" || ["BLOCKED", "SUSPENDED", "DELETED"].includes(String(profile.status).toUpperCase())) {
      return json({ error: "This account cannot submit identity verification." }, 403);
    }

    const body = await req.json().catch(() => null);
    const documentType = body?.documentType === "CNIC" || body?.documentType === "PASSPORT" ? body.documentType : null;
    const frontPath = typeof body?.frontPath === "string" ? body.frontPath : "";
    const backPath = typeof body?.backPath === "string" ? body.backPath : "";
    if (!body?.processingConsent) return json({ error: "Consent to secure identity document review is required." }, 400);
    if (!documentType || !frontPath.startsWith(auth.user.id + "/kyc/")) return json({ error: "A valid document type and front image are required." }, 400);
    if (documentType === "CNIC" && !backPath.startsWith(auth.user.id + "/kyc/")) return json({ error: "Upload both front and back images for a CNIC." }, 400);
    if (documentType === "PASSPORT" && backPath) return json({ error: "A passport submission requires only the photo page." }, 400);

    const { data: verified } = await admin.from("kyc_verifications").select("id").eq("user_id", profile.id).eq("status", "VERIFIED").limit(1).maybeSingle();
    if (verified) return json({ error: "KYC is already verified for this account." }, 409);
    const { data: inProgress } = await admin.from("kyc_verifications").select("id").eq("user_id", profile.id)
      .in("status", ["PENDING_REVIEW", "MANUAL_REVIEW"]).limit(1).maybeSingle();
    if (inProgress) return json({ error: "Your current KYC review is still in progress." }, 409);

    const { data: record, error: insertError } = await admin.from("kyc_verifications").insert({
      user_id: profile.id, document_type: documentType, front_storage_path: frontPath,
      back_storage_path: backPath || null, processing_consent_at: new Date().toISOString(),
      status: "PENDING_REVIEW", ai_review_status: "PENDING_REVIEW", ai_policy_version: POLICY_VERSION,
    }).select("id,status,ai_review_status,submitted_at").single();
    if (insertError || !record) return json({ error: insertError?.message || "Unable to create KYC review." }, 400);

    let review: { configured: boolean; result?: Record<string, unknown> } = { configured: false, result: {} };
    if (aiEnabled) {
      try {
        const images = [await loadPrivateImage(admin.storage, frontPath)];
        if (documentType === "CNIC") images.push(await loadPrivateImage(admin.storage, backPath));
        review = await runVisionReview([
          "Perform an AI precheck of the attached government identity document for AegisPay KYC.",
          "Expected document type: " + documentType + ".",
          "Profile display name to compare with the document: " + JSON.stringify(profile.name) + ".",
          "Check only visible evidence: document type, image quality, readability, whether the document appears complete, name consistency, and visible signs of alteration/tampering.",
          "Do not claim official government/NADRA verification. Do not return or store document number, date of birth, address, or other extracted personal values.",
          "Return ONLY JSON: document_type_matches boolean; front_readable boolean; back_readable boolean|null; front_blurry boolean; back_blurry boolean; name_matches_profile boolean; tamper_indicators array of short codes; confidence number 0..1.",
          "Use false when a required fact is clearly contradicted. Use conservative confidence when anything is cropped, obscured, ambiguous, or inconsistent.",
        ].join("\n"), images);
      } catch {
        review = { configured: false, result: {} };
      }
    }

    const result = review.result || {};
    const confidence = Number(result.confidence);
    const hasConfidence = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
    const normalizedConfidence = hasConfidence ? Math.round(confidence * 1000) / 1000 : null;
    const hardFailure = hasConfidence && confidence >= 0.85 && (
      result.front_blurry === true || result.back_blurry === true ||
      result.front_readable === false || result.back_readable === false ||
      result.document_type_matches === false || result.name_matches_profile === false
    );
    const potentialTampering = Array.isArray(result.tamper_indicators) && result.tamper_indicators.length > 0;
    const aiApproved = aiEnabled && review.configured && hasConfidence && confidence >= 0.95
      && result.document_type_matches === true
      && result.front_readable === true
      && (documentType === "PASSPORT" || result.back_readable === true)
      && result.front_blurry === false
      && (documentType === "PASSPORT" || result.back_blurry === false)
      && result.name_matches_profile === true
      && !potentialTampering;

    let status: "REJECTED" | "MANUAL_REVIEW" = "MANUAL_REVIEW";
    let aiStatus: "APPROVED" | "REJECTED" | "MANUAL_REVIEW" | "UNAVAILABLE" = "MANUAL_REVIEW";
    if (!aiEnabled) {
      aiStatus = "MANUAL_REVIEW";
    } else if (!review.configured) {
      aiStatus = "UNAVAILABLE";
    } else if (hardFailure) {
      status = "REJECTED";
      aiStatus = "REJECTED";
    } else if (aiApproved) {
      // AI approval is a precheck only. Final VERIFIED status remains Master Admin-controlled.
      status = "MANUAL_REVIEW";
      aiStatus = "APPROVED";
    }

    const reason = !aiEnabled ? "AI_BOT_DISABLED" : reasonFor(result, hasConfidence ? confidence : 0, review.configured);
    const checks = {
      document_type_matches: result.document_type_matches === true,
      front_readable: result.front_readable === true,
      back_readable: documentType === "PASSPORT" ? true : result.back_readable === true,
      front_blurry: result.front_blurry === true,
      back_blurry: documentType === "PASSPORT" ? false : result.back_blurry === true,
      name_matches_profile: result.name_matches_profile === true,
      tamper_indicators: Array.isArray(result.tamper_indicators) ? result.tamper_indicators.slice(0, 10) : [],
      ai_gate: aiApproved ? "PASS" : status === "REJECTED" ? "FAIL" : "MANUAL",
    };

    const { error: updateError } = await admin.from("kyc_verifications").update({
      status, ai_review_status: aiStatus, ai_confidence: normalizedConfidence,
      ai_checks: checks, ai_policy_version: POLICY_VERSION,
      review_reason: status === "REJECTED" ? reason : (aiStatus === "APPROVED" ? "AI_PRECHECK_PASSED" : reason),
      reviewed_at: status === "REJECTED" ? new Date().toISOString() : null,
      reviewed_by: null,
    }).eq("id", record.id);
    if (updateError) return json({ error: "KYC review could not be saved." }, 500);

    const clientMessage = !aiEnabled
      ? "AI approval bot is currently OFF. Your KYC has been sent to Master Admin for manual review."
      : status === "REJECTED"
      ? reasonMessage(reason, documentType)
      : aiStatus === "APPROVED"
      ? "Your identity images passed the AI quality and consistency precheck. Final KYC verification is pending Master Admin review."
      : reasonMessage(reason, documentType);

    await admin.from("audit_events").insert({
      actor_user_id: null, target_user_id: profile.id, event_type: "AI_KYC_REVIEW",
      description: "AI KYC precheck: " + aiStatus + " (" + reason + ")" + (normalizedConfidence !== null ? ", confidence " + normalizedConfidence : ""),
      reference_id: record.id,
    });
    await admin.from("notifications").insert({
      user_id: profile.id, notification_type: status === "REJECTED" ? "KYC_ACTION_REQUIRED" : "KYC_UPDATE",
      title: status === "REJECTED" ? "KYC needs attention" : "KYC review update",
      body: clientMessage, is_read: false,
    });

    return json({
      verificationId: record.id, status, aiReviewStatus: aiStatus,
      message: clientMessage, reviewReason: reason,
      aiConfidence: normalizedConfidence,
    }, 202);
  } catch {
    return json({ error: "Unable to process KYC submission." }, 500);
  }
});

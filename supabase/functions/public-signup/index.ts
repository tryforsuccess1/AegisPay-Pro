import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PRODUCTION_REDIRECT = "https://aegispay-web.aegispay.workers.dev/?verified=1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

const ipLastSeen = new Map<string, number>();
const emailLastSeen = new Map<string, number>();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const requestId = crypto.randomUUID();

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Signup service is not configured.", code: "SIGNUP_NOT_CONFIGURED", requestId }, 503);
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const referralCode = typeof body?.referralCode === "string" ? body.referralCode.trim().toUpperCase() : "";
    const preferredLanguage = body?.preferredLanguage === "ur" ? "ur" : "en";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: "Enter a valid email address.", code: "INVALID_EMAIL", requestId }, 400);
    if (name.length < 2 || name.length > 100) return json({ error: "Enter a valid full name.", code: "INVALID_NAME", requestId }, 400);
    if (!/^[a-z0-9_]{3,32}$/.test(username)) return json({ error: "Username must be 3 to 32 characters using letters, numbers or underscore.", code: "INVALID_USERNAME", requestId }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: "Password must contain 8 to 128 characters.", code: "INVALID_PASSWORD", requestId }, 400);
    if (referralCode.length > 32) return json({ error: "Referral code is too long.", code: "INVALID_REFERRAL", requestId }, 400);

    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
    const now = Date.now();
    if ((now - (ipLastSeen.get(ip) || 0)) < 15_000 || (now - (emailLastSeen.get(email) || 0)) < 60_000) {
      return json({ error: "Please wait a moment before trying signup again.", code: "SIGNUP_RATE_LIMIT", requestId }, 429);
    }
    ipLastSeen.set(ip, now);
    emailLastSeen.set(email, now);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: existingProfile, error: existingError } = await admin.from("users").select("id,status,role").eq("email", email).maybeSingle();
    if (existingError) {
      console.error("public-signup profile lookup failed", { requestId, message: existingError.message, code: existingError.code });
      return json({ error: "Unable to check the account right now.", code: "PROFILE_LOOKUP_FAILED", requestId }, 503);
    }
    const { data: existingUsername, error: usernameError } = await admin.from("users").select("id").ilike("username", username).maybeSingle();
    if (usernameError) return json({ error: "Unable to check the username right now.", code: "USERNAME_LOOKUP_FAILED", requestId }, 503);
    if (existingUsername) return json({ error: "This username is already in use.", code: "USERNAME_EXISTS", requestId }, 409);
    if (existingProfile) return json({ error: "This email already has an AegisPay profile. Please sign in.", code: "PROFILE_EXISTS", requestId }, 409);

    let referrerId: string | null = null;
    if (referralCode) {
      const { data: referrer, error: referralError } = await admin.from("users").select("id").eq("referral_code", referralCode).eq("role", "USER").in("status", ["Active", "NORMAL", "ACTIVE"]).maybeSingle();
      if (referralError) {
        console.error("public-signup referral validation failed", { requestId, message: referralError.message, code: referralError.code });
        return json({ error: "Unable to validate the referral code. Please try again.", code: "REFERRAL_CHECK_FAILED", requestId }, 503);
      }
      if (!referrer) return json({ error: "Referral code is invalid.", code: "INVALID_REFERRAL", requestId }, 400);
      referrerId = referrer.id;
    }

    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    if (!ANON_KEY) return json({ error: "Signup email service is not configured.", code: "SIGNUP_EMAIL_NOT_CONFIGURED", requestId }, 503);

    // Security rule: the client may never choose the post-verification destination.
    // This prevents old Netlify builds, stale links, or manipulated redirectTo values
    // from sending users to an obsolete UI.
    const publicClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await publicClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name.slice(0, 100), username, referral_code: referralCode, preferred_language: preferredLanguage },
        emailRedirectTo: PRODUCTION_REDIRECT
      }
    });

    if (error || !data?.user) {
      const rawMessage = String(error?.message || "AegisPay could not create the account.");
      const lower = rawMessage.toLowerCase();
      console.error("public-signup auth signup failed", { requestId, status: error?.status ?? null, code: error?.code ?? null, message: rawMessage });
      let status = Number(error?.status || 0);
      if (!Number.isFinite(status) || status < 400 || status > 599) status = 500;

      if (/error sending confirmation email|could not send email|smtp|gomail/i.test(lower)) {
        console.error("public-signup confirmation email delivery failed", { requestId, status: error?.status ?? null, code: error?.code ?? null, message: rawMessage });
        return json({ error: "Email verification service is temporarily unavailable. The account was not created. Please try again after the email service is fixed.", code: "EMAIL_DELIVERY_FAILED", requestId }, 503);
      }
      if (/already registered|already exists|duplicate|23505/.test(lower)) status = 409;
      else if (/invalid|validation|password|email|referral/.test(lower) && status >= 500) status = 400;
      return json({ error: status >= 500 ? "AegisPay could not create the account right now. Please try again." : rawMessage, code: status >= 500 ? "SIGNUP_SERVER_ERROR" : (error?.code || "SIGNUP_VALIDATION_ERROR"), requestId }, status);
    }

    if (data.session) {
      try { await admin.auth.admin.deleteUser(data.user.id); } catch (_) {}
      return json({ error: "Email verification is not enabled yet. Please enable Confirm Email in Supabase Authentication settings.", code: "EMAIL_CONFIRMATION_REQUIRED", requestId }, 503);
    }

    const { error: appMetaError } = await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { aegispay_approved: true, signup_channel: "client_email_verification" } });
    if (appMetaError) {
      console.error("public-signup app metadata update failed", { requestId, authUserId: data.user.id, message: appMetaError.message });
      try { await admin.auth.admin.deleteUser(data.user.id); } catch (_) {}
      return json({ error: "Account security setup could not be completed. Please try again.", code: "APP_METADATA_FAILED", requestId }, 500);
    }

    const { data: linkedProfile, error: profileError } = await admin.from("users").select("id,role,status,referred_by").eq("auth_user_id", data.user.id).maybeSingle();
    if (profileError || !linkedProfile) {
      console.error("public-signup profile link failed", { requestId, authUserId: data.user.id, expectedReferrerId: referrerId, message: profileError?.message || "Profile was not created by the Auth trigger.", code: profileError?.code || null });
      try { await admin.auth.admin.deleteUser(data.user.id); } catch (cleanupError) { console.error("public-signup cleanup failed", { requestId, message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }); }
      return json({ error: "Account setup could not be completed. No usable AegisPay account was created.", code: "PROFILE_LINK_FAILED", requestId }, 500);
    }

    if (referrerId && !linkedProfile.referred_by) {
      const { error: attributionError } = await admin.from("users").update({ referred_by: referrerId }).eq("id", linkedProfile.id).is("referred_by", null);
      if (attributionError) {
        console.error("public-signup referral attribution failed", { requestId, authUserId: data.user.id, referrerId, message: attributionError.message, code: attributionError.code });
        try { await admin.auth.admin.deleteUser(data.user.id); } catch (_) {}
        return json({ error: "Referral attribution could not be completed. No usable AegisPay account was created.", code: "REFERRAL_ATTRIBUTION_FAILED", requestId }, 500);
      }
      linkedProfile.referred_by = referrerId;
    }

    return json({
      user: { id: data.user.id, email: data.user.email || email },
      profile: { id: linkedProfile.id, role: linkedProfile.role, status: linkedProfile.status, referred_by: linkedProfile.referred_by ?? null },
      message: "Account created. Please check your email and verify your email address before signing in.", requestId
    }, 201);
  } catch (error) {
    console.error("public-signup unexpected failure", { requestId, message: error instanceof Error ? error.message : String(error) });
    return json({ error: "AegisPay signup service failed unexpectedly. Please try again.", code: "SIGNUP_UNEXPECTED_ERROR", requestId }, 500);
  }
});
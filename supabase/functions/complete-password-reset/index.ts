import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "Password reset service is not configured." }, 503);
  }

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);

    const body = await req.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < 8) {
      return json({ error: "Password must contain at least 8 characters." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid or expired password reset session." }, 401);

    const { data: profile, error: profileError } = await admin.from("users")
      .select("id,auth_user_id,role,status,password_reset_at,frozen_until")
      .eq("auth_user_id", auth.user.id)
      .maybeSingle();

    if (profileError || !profile) return json({ error: "AegisPay profile not found." }, 404);
    if (profile.role !== "USER") return json({ error: "Only client accounts can use password recovery." }, 403);
    if (!["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
      return json({ error: "This account is not eligible for password recovery." }, 403);
    }

    const oldResetAt = profile.password_reset_at;
    const oldFrozenUntil = profile.frozen_until;
    const resetAt = new Date();
    const frozenUntil = new Date(resetAt.getTime() + 24 * 60 * 60 * 1000);

    // Freeze first so a successful password change can never leave the account unfrozen.
    const { error: freezeError } = await admin.from("users")
      .update({
        password_reset_at: resetAt.toISOString(),
        frozen_until: frozenUntil.toISOString(),
      })
      .eq("id", profile.id)
      .eq("auth_user_id", auth.user.id);

    if (freezeError) return json({ error: "Security freeze could not be recorded. Password was not changed." }, 500);

    const { error: passwordError } = await admin.auth.admin.updateUserById(auth.user.id, { password });

    if (passwordError) {
      await admin.from("users").update({
        password_reset_at: oldResetAt,
        frozen_until: oldFrozenUntil,
      }).eq("id", profile.id);
      return json({ error: passwordError.message || "Password could not be updated." }, 400);
    }

    await admin.from("audit_events").insert({
      actor_user_id: null,
      target_user_id: profile.id,
      event_type: "PASSWORD_RESET",
      description: "Client password reset completed; 24-hour security freeze applied.",
      reference_id: auth.user.id,
    });

    return json({
      status: "PASSWORD_RESET_COMPLETE",
      passwordResetAt: resetAt.toISOString(),
      frozenUntil: frozenUntil.toISOString(),
      message: "Password updated successfully. Your account is temporarily frozen for security. Please sign in again after the reset.",
    });
  } catch {
    return json({ error: "Unable to complete password reset." }, 500);
  }
});

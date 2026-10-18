import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ enabled: false }, 503);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ enabled: false }, 401);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authResult, error: authError } = await admin.auth.getUser(token);
    if (authError || !authResult.user) return json({ enabled: false }, 401);

    const { data: profile, error: profileError } = await admin.from("users")
      .select("id,role,status")
      .eq("auth_user_id", authResult.user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ enabled: false }, 403);
    if (String(profile.role || "").toUpperCase() !== "USER"
      || !["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
      return json({ enabled: false }, 403);
    }

    const { data: rows, error: settingsError } = await admin.from("platform_settings")
      .select("key,value_json")
      .in("key", ["app_runtime", "production_config", "system_mode"]);
    if (settingsError) return json({ enabled: false }, 503);
    const settings = Object.fromEntries((rows || []).map((row: any) => [row.key, row.value_json || {}]));
    const runtime = settings.app_runtime || {};
    const production = settings.production_config || {};
    const mode = settings.system_mode || {};

    const enabled = runtime.enabled === true
      && String(production.environment || "").toUpperCase() === "PRE_PRODUCTION"
      && production.live_deposits_enabled !== true
      && production.real_payouts_enabled !== true
      && production.go_live_approved !== true
      && production.payouts_locked === true
      && mode.live_deposits !== true
      && mode.real_payouts !== true
      && mode.production_go_live_approved !== true;

    return json({ enabled });
  } catch {
    return json({ enabled: false }, 500);
  }
});

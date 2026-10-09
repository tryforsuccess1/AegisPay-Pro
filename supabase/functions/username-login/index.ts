import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

type RateWindow = { startedAt: number; count: number };
const ipWindows = new Map<string, RateWindow>();
const usernameWindows = new Map<string, RateWindow>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_IP_ATTEMPTS = 20;
const MAX_USERNAME_ATTEMPTS = 8;

function allowed(map: Map<string, RateWindow>, key: string, max: number, now: number) {
  const current = map.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    map.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

function trimExpired(map: Map<string, RateWindow>, now: number) {
  if (map.size < 2000) return;
  for (const [key, value] of map) {
    if (now - value.startedAt >= WINDOW_MS) map.delete(key);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const requestId = crypto.randomUUID();
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: "Username login is not configured.", code: "LOGIN_NOT_CONFIGURED", requestId }, 503);
  }

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!/^[a-z0-9_]{3,32}$/.test(username) || password.length < 1 || password.length > 128) {
      return json({ error: "Invalid username or password.", code: "INVALID_CREDENTIALS", requestId }, 401);
    }

    const now = Date.now();
    trimExpired(ipWindows, now);
    trimExpired(usernameWindows, now);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
    if (!allowed(ipWindows, ip, MAX_IP_ATTEMPTS, now) ||
        !allowed(usernameWindows, username, MAX_USERNAME_ATTEMPTS, now)) {
      return json({ error: "Too many login attempts. Please wait before trying again.", code: "LOGIN_RATE_LIMIT", requestId }, 429);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("email,role,status,frozen_until")
      .eq("username", username)
      .maybeSingle();

    if (profileError) {
      console.error("username-login profile lookup failed", { requestId, code: profileError.code });
      return json({ error: "Login is temporarily unavailable. Please try again.", code: "LOGIN_LOOKUP_FAILED", requestId }, 503);
    }

    // Use a non-existent email for unknown usernames and always return one generic credential error.
    // This keeps the endpoint from revealing which usernames have registered profiles.
    const candidateEmail = profile?.email || ("unknown-" + crypto.randomUUID() + "@invalid.example");
    const auth = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authResult, error: authError } = await auth.auth.signInWithPassword({
      email: String(candidateEmail).trim().toLowerCase(),
      password
    });

    if (authError || !authResult?.session || !authResult.user || !profile) {
      return json({ error: "Invalid username or password.", code: "INVALID_CREDENTIALS", requestId }, 401);
    }

    if (profile.role !== "USER" ||
        !["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase()) ||
        (profile.frozen_until && new Date(profile.frozen_until).getTime() > now)) {
      return json({ error: "This account is not currently available for client sign-in.", code: "ACCOUNT_UNAVAILABLE", requestId }, 403);
    }

    return json({
      access_token: authResult.session.access_token,
      refresh_token: authResult.session.refresh_token,
      expires_in: authResult.session.expires_in,
      token_type: authResult.session.token_type,
      requestId
    }, 200);
  } catch (error) {
    console.error("username-login unexpected failure", {
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
    return json({ error: "Login failed. Please try again.", code: "LOGIN_FAILED", requestId }, 500);
  }
});

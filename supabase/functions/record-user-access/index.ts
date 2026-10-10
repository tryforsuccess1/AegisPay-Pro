import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

function clientIp(req: Request) {
  const candidate = req.headers.get("cf-connecting-ip") ||
    req.headers.get("true-client-ip") ||
    req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  return String(candidate || "").trim().slice(0, 64) || null;
}
function isPublicIp(ip: string) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v !== "::1" && !v.startsWith("fe80:") && !v.startsWith("fc") && !v.startsWith("fd") && !v.startsWith("::ffff:127.");
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
  if ([a,b,c,d].some((n) => n < 0 || n > 255)) return false;
  return !(a === 10 || a === 127 || a === 0 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ||
    a >= 224 || a === 100 && b >= 64 && b <= 127);
}
function safeHeader(req: Request, name: string, max = 100) {
  return String(req.headers.get(name) || "").trim().slice(0, max);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Access log service is not configured." }, 503);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid authentication token." }, 401);
    const { data: profile, error: profileError } = await admin.from("users")
      .select("id,role,status").eq("auth_user_id", auth.user.id).maybeSingle();
    if (profileError || !profile) return json({ error: "AegisPay profile not found." }, 404);
    if (profile.role !== "USER" || !["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
      return json({ error: "Active client account access is required." }, 403);
    }

    const body = await req.json().catch(() => null);
    const eventType = ["APP_OPEN", "LOGIN"].includes(String(body?.eventType || "")) ? String(body.eventType) : "APP_OPEN";
    const ip = clientIp(req);
    let countryCode = safeHeader(req, "cf-ipcountry", 2).toUpperCase();
    let countryName = safeHeader(req, "x-geo-country", 80);
    let region = safeHeader(req, "x-geo-region", 80);
    let city = safeHeader(req, "x-geo-city", 100);
    let geoSource = countryCode ? "edge-country-header" : "unresolved";
    if (countryCode === "XX" || countryCode === "T1") countryCode = "";
    if (ip && isPublicIp(ip) && (!countryCode || !city)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const geoResponse = await fetch("https://ipwho.is/" + encodeURIComponent(ip) + "?fields=success,country,country_code,region,city", { signal: controller.signal });
        clearTimeout(timer);
        const geo = await geoResponse.json().catch(() => null);
        if (geoResponse.ok && geo?.success) {
          countryCode = countryCode || String(geo.country_code || "").slice(0, 2).toUpperCase();
          countryName = countryName || String(geo.country || "").slice(0, 80);
          region = region || String(geo.region || "").slice(0, 80);
          city = city || String(geo.city || "").slice(0, 100);
          geoSource = "ipwho.is-approximate";
        }
      } catch (_) {
        // Keep the IP log even when geo lookup is unavailable.
      }
    }
    const { error: writeError } = await admin.from("user_access_events").insert({
      user_id: profile.id, auth_user_id: auth.user.id, event_type,
      ip_address: ip, country_code: countryCode || null, country_name: countryName || null,
      region: region || null, city: city || null, user_agent: safeHeader(req, "user-agent", 400),
    });
    if (writeError) return json({ error: "User access event could not be recorded." }, 500);
    await admin.from("user_access_events").delete().lt("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
    return json({
      recorded: true, ipAddress: ip, countryCode: countryCode || null,
      countryName: countryName || null, region: region || null, city: city || null,
      geoSource, gpsCollected: false, retentionDays: 90,
    });
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, error.status);
    return json({ error: "Unable to record user access." }, 503);
  }
});

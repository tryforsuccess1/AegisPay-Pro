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
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Shop checkout service is not configured." }, 503);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authorization required." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Invalid authentication token." }, 401);

    const { data: profile, error: profileError } = await admin.from("users")
      .select("id,role,status,frozen_until")
      .eq("auth_user_id", auth.user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "AegisPay profile not found." }, 404);
    if (profile.role !== "USER" || !["ACTIVE","NORMAL"].includes(String(profile.status || "").toUpperCase())) {
      return json({ error: "Active client access is required." }, 403);
    }
    if (profile.frozen_until && new Date(profile.frozen_until).getTime() > Date.now()) {
      return json({ error: "Account is temporarily frozen for security. Shop checkout is unavailable until the freeze expires." }, 423);
    }

    const { data: enabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (enabled !== true) return json({ error: "AegisPay is paused by Master Admin." }, 423);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const cycleId = body?.cycleId;
    const taskIds = Array.isArray(body?.taskIds) ? body!.taskIds as unknown[] : [];
    if (!uuid(cycleId)) return json({ error: "A valid Shop cycle is required." }, 400);
    if (!taskIds.length || taskIds.length > 100 || taskIds.some((id) => !uuid(id))) {
      return json({ error: "The complete assigned task set is required." }, 400);
    }

    const { data: cycleBefore, error: cycleError } = await admin.from("cycle_runs")
      .select("id,user_id,status,cycle_base,task_completed_at,ready_at")
      .eq("id", cycleId).eq("user_id", profile.id).maybeSingle();
    if (cycleError || !cycleBefore) return json({ error: "Shop cycle not found." }, 404);
    if (cycleBefore.status === "WAITING_18H") return json({ status: "WAITING_18H", cycle: cycleBefore });
    if (cycleBefore.status !== "TASKS_OPEN") return json({ error: "This Shop cycle is not accepting checkout." }, 409);

    const { data: tasks, error: tasksError } = await admin.from("tasks")
      .select("id,cycle_id,user_id,status,task_value")
      .eq("cycle_id", cycleBefore.id).eq("user_id", profile.id)
      .order("id", { ascending: true });
    if (tasksError) return json({ error: "Unable to load assigned Shop tasks." }, 500);
    if (!tasks?.length) return json({ error: "This Shop cycle has no assigned tasks." }, 409);
    if (tasks.some((task) => task.status === "Completed")) {
      return json({ error: "This cycle contains a partially completed task set. Manual reconciliation is required." }, 409);
    }

    const requested = [...new Set(taskIds.map(String))].sort();
    const assigned = tasks.map((task) => String(task.id)).sort();
    if (requested.length !== assigned.length || requested.some((id, i) => id !== assigned[i])) {
      return json({ error: "Checkout must include every assigned Shop task exactly once." }, 409);
    }

    const taskTotal = tasks.reduce((sum, task) => sum + Number(task.task_value || 0), 0);
    if (!Number.isFinite(taskTotal) || Math.abs(taskTotal - Number(cycleBefore.cycle_base || 0)) > 0.01) {
      return json({ error: "Assigned Shop task values do not equal the full cycle balance." }, 409);
    }

    const { data: closed, error: rpcError } = await admin.rpc("complete_shop_cycle_checkout", {
      p_user_id: profile.id,
      p_cycle_id: cycleBefore.id,
      p_task_ids: tasks.map((task) => task.id),
    });

    if (rpcError) return json({ error: String(rpcError.message || "Shop checkout failed.") }, 409);
    if (!closed) return json({ error: "Shop cycle could not be completed." }, 409);

    return json({ status: "WAITING_18H", cycle: closed, completedTaskCount: tasks.length }, 200);
  } catch {
    return json({ error: "Shop checkout could not be completed." }, 500);
  }
});
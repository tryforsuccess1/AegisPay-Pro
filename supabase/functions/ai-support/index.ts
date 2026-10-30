import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requestAegisAI } from "../_shared/aegis-ai-client.ts";
import { isExplicitHumanSupportRequest, shouldEscalateUnresolvedIssue } from "../_shared/ai-support-escalation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

function sanitizeClientAnswer(value: unknown): string {
  const text = String(value || "").trim();
  return /\bmaster\s+admin\b|\btelegram\b/i.test(text)
    ? "A representative may contact you soon."
    : text;
}


type SupportContext = {
  account: {
    name: string;
    display_name: string;
    status: string;
    total_balance_usdt: number;
    available_balance_usdt: number;
    withdrawal_held_usdt: number;
    first_deposit_done: boolean;
    tier: string | null;
    wallet_linked: boolean;
  };
  shop: {
    cycle_status: string | null;
    cycle_base_usdt: number;
    ready_at: string | null;
    task_count: number;
    pending_tasks: number;
    completed_tasks: number;
    task_value_usdt: number;
    reward_usdt: number;
  };
  kyc: {
    status: string | null;
    ai_review_status: string | null;
    review_reason: string | null;
  };
  withdrawal: {
    status: string | null;
    amount_usdt: number;
    fee_usdt: number;
    net_usdt: number;
  };
  referrals: {
    total: number;
    level_1: number;
    level_2: number;
    reward_usdt: number;
  };
};

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function normalizeContext(row: any, tier: any, cycle: any, tasks: any[], kyc: any, withdrawal: any, referrals: any[]): SupportContext {
  const totalBalance = n(row?.current_platform_balance);
  const held = n(row?.withdrawal_held);
  const available = Math.max(0, totalBalance - held);
  const taskList = Array.isArray(tasks) ? tasks : [];
  const refList = Array.isArray(referrals) ? referrals : [];
  return {
    account: {
      name: String(row?.name || "Client"),
      display_name: String(row?.display_name || row?.name || "Client"),
      status: String(row?.status || "Active"),
      total_balance_usdt: Number(totalBalance.toFixed(2)),
      available_balance_usdt: Number(available.toFixed(2)),
      withdrawal_held_usdt: Number(held.toFixed(2)),
      first_deposit_done: row?.first_deposit_done === true,
      tier: tier?.name ? String(tier.name) : null,
      wallet_linked: Boolean(row?.destination_address),
    },
    shop: {
      cycle_status: cycle?.status ? String(cycle.status) : null,
      cycle_base_usdt: Number(n(cycle?.cycle_base).toFixed(2)),
      ready_at: cycle?.ready_at || null,
      task_count: taskList.length,
      pending_tasks: taskList.filter((x) => String(x?.status || "").toUpperCase() !== "COMPLETED").length,
      completed_tasks: taskList.filter((x) => String(x?.status || "").toUpperCase() === "COMPLETED").length,
      task_value_usdt: Number(taskList.reduce((sum, x) => sum + n(x?.task_value), 0).toFixed(2)),
      reward_usdt: Number(taskList.reduce((sum, x) => sum + n(x?.reward), 0).toFixed(2)),
    },
    kyc: {
      status: kyc?.status ? String(kyc.status) : null,
      ai_review_status: kyc?.ai_review_status ? String(kyc.ai_review_status) : null,
      review_reason: kyc?.review_reason ? String(kyc.review_reason) : null,
    },
    withdrawal: {
      status: withdrawal?.status ? String(withdrawal.status) : null,
      amount_usdt: Number(n(withdrawal?.amount).toFixed(2)),
      fee_usdt: Number(n(withdrawal?.fee_amount).toFixed(2)),
      net_usdt: Number(n(withdrawal?.net_amount).toFixed(2)),
    },
    referrals: {
      total: refList.length,
      level_1: refList.filter((x) => Number(x?.referral_level) === 1).length,
      level_2: refList.filter((x) => Number(x?.referral_level) === 2).length,
      reward_usdt: Number(refList.reduce((sum, x) => sum + n(x?.platform_reward), 0).toFixed(2)),
    },
  };
}

async function loadSupportContext(admin: ReturnType<typeof createClient<any>>, profile: any): Promise<SupportContext> {
  const [userR, cycleR, taskR, kycR, withdrawalR, referralR] = await Promise.all([
    admin.from("users")
      .select("id,name,display_name,status,current_platform_balance,withdrawal_held,first_deposit_done,selected_tier_id,destination_address")
      .eq("id", profile.id).maybeSingle(),
    admin.from("cycle_runs")
      .select("id,status,tier_id,cycle_base,ready_at")
      .eq("user_id", profile.id)
      .in("status", ["TASKS_OPEN", "WAITING_18H"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("tasks")
      .select("id,status,reward,task_value,cycle_id")
      .eq("user_id", profile.id)
      .order("due_date", { ascending: false }).limit(100),
    admin.from("kyc_verifications")
      .select("status,ai_review_status,review_reason,submitted_at")
      .eq("user_id", profile.id)
      .order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("withdrawal_requests")
      .select("status,amount,fee_amount,net_amount,created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("referrals")
      .select("referral_level,platform_reward,created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false }).limit(200),
  ]);

  const user = userR.data || profile;
  let tier: any = null;
  const tierId = String(user?.selected_tier_id || cycleR.data?.tier_id || "");
  if (tierId) {
    const tierR = await admin.from("vip_tiers").select("id,name,deposit_amount").eq("id", tierId).maybeSingle();
    tier = tierR.data || null;
  }

  return normalizeContext(user, tier, cycleR.data, taskR.data || [], kycR.data, withdrawalR.data, referralR.data || []);
}

async function handleSafeOperation(admin: ReturnType<typeof createClient<any>>, profile: any, message: string, context: SupportContext) {
  const q = message.trim();
  const m = q.match(/(?:change|update|edit|set)\s+(?:my\s+)?(?:display\s+)?name\s+(?:to|as)\s+["“']?([^"”']{2,60})["”']?\s*$/i);
  if (m) {
    const requested = m[1].trim().replace(/\s+/g, " ");
    const { data, error } = await admin.rpc("ai_update_display_name_for_user", { p_user_id: profile.id, p_name: requested });
    if (error) return { handled: true, answer: "I could not update your display name: " + (error.message || "Please try again.") };
    return { handled: true, answer: "Done. Your display name has been updated to " + String(data?.display_name || requested) + ". Your legal/profile name used for identity verification remains unchanged." };
  }
  if (/(shop|task|tasks)/i.test(q) && /(not showing|missing|not appear|not opening|no tasks|disappeared|stuck)/i.test(q)) {
    if (context.shop.cycle_status) {
      if (context.shop.task_count === 0) return { handled: true, needsEscalation: true, answer: "I found an active Shop cycle but no task records were available to display. I have sent this for support review rather than changing your balance or cycle unsafely." };
      return { handled: true, answer: "I checked your account. Your current Shop cycle is " + context.shop.cycle_status + " with " + context.shop.pending_tasks + " pending task(s) and " + context.shop.completed_tasks + " completed task(s)." };
    }
    const { data: cycleId, error } = await admin.rpc("ensure_auto_task_cycle", { p_user_id: profile.id });
    if (!error && cycleId) return { handled: true, answer: "I found that your Shop cycle was missing, so I restored the normal automatic Shop cycle. Please reopen Shop; the new task assignment is now recorded." };
    return { handled: true, needsEscalation: true, answer: "I could not safely restore a Shop cycle using the current balance and tier rules. I have sent this for support review; I did not change your balance." };
  }
  return { handled: false };
}
function fallback(message: string, ctx: SupportContext, history: Array<{role:string;content:string}> = []) {
  const q = message.toLowerCase().trim();
  const money = (v: number) => v.toFixed(2) + " USDT";
  const hasUrduScript = /[\u0600-\u06ff]/.test(message);
  const roman = (en: string, ru: string, ur: string) => hasUrduScript ? ur : /\b(mera|meri|mujhe|kaise|kyun|kahan|kitna|batao|hai|hain|kr|kar|karo|chahiye|nahi|apka|aap)\b/i.test(message) ? ru : en;

  // Lightweight intent router used when the external LLM provider is unavailable.
  // It deliberately answers the user's actual intent instead of returning a generic capability list.
  if (/\b(change|edit|update|modify)\b/.test(q) && /\b(name|profile name|username|display name)\b/.test(q)) {
    return roman(
      "Your profile name cannot currently be changed from the client portal. Open Profile to review your account details; for an authorized name change, contact our support team.",
      "Abhi client portal mein profile name direct change nahi hota. Profile open karke account details check kar sakte hain; authorized name change ke liye support team se contact karein.",
      "فی الحال کلائنٹ پورٹل سے پروفائل نام براہِ راست تبدیل نہیں کیا جا سکتا۔ Profile میں اپنی details دیکھیں، اور نام تبدیل کروانے کے لیے support team سے رابطہ کریں۔"
    );
  }

  if (/\b(change|edit|update|modify)\b/.test(q) && /\b(username|client id|id)\b/.test(q)) {
    return roman(
      "Your username is used as your memorable Client ID where available. Client IDs are not changed from the client portal; please contact our support team for an authorized change.",
      "Aapka username hi memorable Client ID ke taur par use hota hai. Client ID client portal se change nahi hoti; authorized change ke liye support team se contact karein.",
      "آپ کا username ہی دستیاب ہونے کی صورت میں آپ کی یاد رہنے والی Client ID کے طور پر استعمال ہوتا ہے۔ Client ID کلائنٹ پورٹل سے تبدیل نہیں کی جا سکتی؛ authorized change کے لیے support team سے رابطہ کریں۔"
    );
  }

  if (/\b(profile|account|personal details|account details)\b/.test(q) && !/\b(change|edit|update|modify)\b/.test(q)) {
    return roman(
      "Open Profile from the bottom navigation. You can review your name, Client ID, email, referral code and linked withdrawal wallet there.",
      "Neeche Profile par jaa kar apna name, Client ID, email, referral code aur linked withdrawal wallet dekh sakte hain.",
      "نیچے Profile کھول کر اپنا نام، Client ID، ای میل، referral code اور linked withdrawal wallet دیکھ سکتے ہیں۔"
    );
  }

  if (/\b(balance|available|kitna|kitni|paisa|funds|wallet)\b/.test(q)) {
    return roman(
      "Your current total balance is " + money(ctx.account.total_balance_usdt) +
      ", and your available balance is " + money(ctx.account.available_balance_usdt) +
      ". " + (ctx.account.withdrawal_held_usdt > 0 ? money(ctx.account.withdrawal_held_usdt) + " is currently held for a pending withdrawal." : "There is no withdrawal hold on the balance."),
      "Aapka total balance " + money(ctx.account.total_balance_usdt) +
      " hai aur available balance " + money(ctx.account.available_balance_usdt) +
      " hai. " + (ctx.account.withdrawal_held_usdt > 0 ? money(ctx.account.withdrawal_held_usdt) + " pending withdrawal ke liye hold hai." : "Balance par koi withdrawal hold nahi hai."),
      "آپ کا کل بیلنس " + money(ctx.account.total_balance_usdt) +
      " ہے اور available balance " + money(ctx.account.available_balance_usdt) +
      " ہے۔ " + (ctx.account.withdrawal_held_usdt > 0 ? money(ctx.account.withdrawal_held_usdt) + " pending withdrawal کے لیے hold ہے۔" : "بیلنس پر کوئی withdrawal hold نہیں ہے۔")
    );
  }

  if (/\b(deposit|top.?up|jama|add funds|fund add|pay in)\b/.test(q)) {
    return roman(
      "To deposit, open Top Up, enter the amount you want to send, use the displayed TRON receiving address, then submit the TXID and payment screenshot for verification. There is no fixed client-side tier selection.",
      "Deposit ke liye Top Up open karein, jitni amount deposit karni hai enter karein, displayed TRON address par payment bhejein, phir TXID aur screenshot verification ke liye submit karein. Fixed tier select karne ki zaroorat nahi.",
      "Deposit کے لیے Top Up کھولیں، جتنی رقم جمع کرنی ہے وہ درج کریں، دکھائے گئے TRON address پر payment بھیجیں، پھر TXID اور screenshot verification کے لیے submit کریں۔ Fixed tier select کرنے کی ضرورت نہیں۔"
    );
  }

  if (/\b(shop|task|tasks|checkout|cycle|settlement|18.?h|18 hours)\b/.test(q)) {
    const cycle = ctx.shop.cycle_status
      ? "Your current Shop cycle is " + ctx.shop.cycle_status + " with a base of " + money(ctx.shop.cycle_base_usdt) + "."
      : "You do not currently have an active Shop cycle.";
    const detail = " You have " + ctx.shop.pending_tasks + " pending task(s) and " + ctx.shop.completed_tasks + " completed.";
    const next = ctx.shop.pending_tasks > 0
      ? " Complete the remaining tasks, then use checkout to start the 18-hour settlement timer."
      : ctx.shop.completed_tasks > 0 && ctx.shop.cycle_status === "WAITING_18H"
        ? " All tasks are complete; the 18-hour settlement timer is already running."
        : "";
    return roman(
      cycle + detail + next,
      (ctx.shop.cycle_status ? "Aapka current Shop cycle " + ctx.shop.cycle_status + " hai aur base " + money(ctx.shop.cycle_base_usdt) + " hai." : "Abhi koi active Shop cycle nahi hai.")
        + detail.replace("pending task(s)","pending task(s)").replace("completed.","complete hue hain.")
        + next.replace("Complete the remaining tasks, then use checkout to start the 18-hour settlement timer.","Baaki tasks complete karein, phir checkout karein taa-ke 18-hour settlement timer start ho.")
          .replace("All tasks are complete; the 18-hour settlement timer is already running.","Saare tasks complete hain; 18-hour settlement timer already chal raha hai."),
      (ctx.shop.cycle_status ? "آپ کا موجودہ Shop cycle " + ctx.shop.cycle_status + " ہے اور base " + money(ctx.shop.cycle_base_usdt) + " ہے۔" : "اس وقت کوئی active Shop cycle نہیں ہے۔")
        + " " + ctx.shop.pending_tasks + " pending task(s) اور " + ctx.shop.completed_tasks + " completed ہیں۔"
        + (ctx.shop.pending_tasks > 0 ? " باقی tasks complete کرکے checkout کریں تاکہ 18-hour settlement timer start ہو۔" : ctx.shop.cycle_status === "WAITING_18H" ? " تمام tasks مکمل ہیں اور 18-hour settlement timer چل رہا ہے۔" : "")
    );
  }

  if (/\b(withdraw|withdrawal|cash.?out|payout|nikal|nikalne|fee|fees|withdrawl)\b/.test(q)) {
    if (ctx.withdrawal.status) {
      return roman(
        "Your latest withdrawal is " + String(ctx.withdrawal.status) + " for " + money(ctx.withdrawal.amount_usdt) +
        ". The recorded fee is " + money(ctx.withdrawal.fee_usdt) + " and the net amount is " + money(ctx.withdrawal.net_usdt) + ".",
        "Aapki latest withdrawal " + String(ctx.withdrawal.status) + " hai, amount " + money(ctx.withdrawal.amount_usdt) +
        ". Recorded fee " + money(ctx.withdrawal.fee_usdt) + " hai aur net " + money(ctx.withdrawal.net_usdt) + ".",
        "آپ کی تازہ ترین withdrawal " + String(ctx.withdrawal.status) + " ہے، رقم " + money(ctx.withdrawal.amount_usdt) +
        " ہے۔ Recorded fee " + money(ctx.withdrawal.fee_usdt) + " ہے اور net amount " + money(ctx.withdrawal.net_usdt) + " ہے۔"
      );
    }
    return roman(
      "Withdrawals require verified KYC and a linked TRON wallet. After submission, the request follows the configured approval workflow.",
      "Withdrawal ke liye verified KYC aur linked TRON wallet zaroori hai. Submit karne ke baad request configured approval workflow mein jati hai.",
      "Withdrawal کے لیے verified KYC اور linked TRON wallet ضروری ہے۔ Submit کرنے کے بعد request configured approval workflow میں جاتی ہے۔"
    );
  }

  if (/\b(kyc|cnic|passport|verification|verify)\b/.test(q)) {
    return roman(
      ctx.kyc.status
        ? "Your latest KYC status is " + ctx.kyc.status + (ctx.kyc.ai_review_status ? " (AI review: " + ctx.kyc.ai_review_status + ")." : ".")
        : "No KYC submission is currently recorded. Upload clear CNIC or Passport images to start verification.",
      ctx.kyc.status
        ? "Aapki latest KYC status " + ctx.kyc.status + (ctx.kyc.ai_review_status ? " hai (AI review: " + ctx.kyc.ai_review_status + ")." : ".")
        : "Abhi koi KYC submission record nahi hai. Clear CNIC ya Passport images upload karke verification start karein.",
      ctx.kyc.status
        ? "آپ کی تازہ ترین KYC status " + ctx.kyc.status + (ctx.kyc.ai_review_status ? " ہے (AI review: " + ctx.kyc.ai_review_status + ")" : "۔")
        : "اس وقت کوئی KYC submission record نہیں ہے۔ واضح CNIC یا Passport images upload کرکے verification شروع کریں۔"
    );
  }

  if (/\b(referr|invite|bonus|reward)\b/.test(q)) {
    return roman(
      "You currently have " + ctx.referrals.total + " referral record(s): " + ctx.referrals.level_1 +
      " at Level 1 and " + ctx.referrals.level_2 + " at Level 2, with recorded referral rewards of " + money(ctx.referrals.reward_usdt) + ".",
      "Aapke " + ctx.referrals.total + " referral record(s) hain: Level 1 mein " + ctx.referrals.level_1 +
      " aur Level 2 mein " + ctx.referrals.level_2 + ". Recorded referral rewards " + money(ctx.referrals.reward_usdt) + " hain.",
      "آپ کے " + ctx.referrals.total + " referral record(s) ہیں: Level 1 میں " + ctx.referrals.level_1 +
      " اور Level 2 میں " + ctx.referrals.level_2 + "۔ Recorded referral rewards " + money(ctx.referrals.reward_usdt) + " ہیں۔"
    );
  }

  if (/\b(password|forgot|reset|login|sign.?in|account locked)\b/.test(q)) {
    return roman(
      "For password help, use Forgot Password on the login screen. The reset link is sent to your registered email. A successful password reset temporarily freezes the account for security.",
      "Password help ke liye login screen par Forgot Password use karein. Reset link registered email par aata hai. Successful password reset ke baad security ke liye account temporarily freeze hota hai.",
      "Password help کے لیے login screen پر Forgot Password استعمال کریں۔ Reset link آپ کی registered email پر بھیجا جاتا ہے۔ Password reset کے بعد security کے لیے account عارضی طور پر freeze ہو جاتا ہے۔"
    );
  }

  if (/\b(help|how do i|how to|kaise|kese|what is|what does|where is|where can|can i|can you|why|kyun|reason|issue|problem|not working)\b/.test(q) && history.length) {
    const prev = history.filter(x => x.role === "user").slice(-1)[0]?.content || "";
    if (prev) {
      return roman(
        "I understand you're asking for help with: " + prev + ". Please tell me the exact step or screen where you are stuck, and I'll guide you from there.",
        "Samajh gaya — aap is maslay mein help chahte hain: " + prev + ". Batayein kis exact step ya screen par ruk rahe hain, main wahin se guide karta hoon.",
        "سمجھ گیا — آپ اس مسئلے میں مدد چاہتے ہیں: " + prev + "۔ بتائیں آپ کس exact step یا screen پر رکے ہوئے ہیں، میں وہیں سے guide کرتا ہوں۔"
      );
    }
  }

  return roman(
    "I understand AegisPay support questions and will answer based on your account and platform rules. Tell me what you are trying to do or what is not working, and I will guide you step by step.",
    "Main AegisPay support questions samajh kar aapke account aur platform rules ke mutabiq guide kar sakta hoon. Batayein aap kya karna chahte hain ya kis jagah problem aa rahi hai, main step by step help karta hoon.",
    "میں AegisPay support کے سوالات آپ کے account اور platform rules کے مطابق سمجھ کر guide کر سکتا ہوں۔ بتائیں آپ کیا کرنا چاہتے ہیں یا کہاں مسئلہ آ رہا ہے، میں step by step مدد کرتا ہوں۔"
  );
}
async function actor(req: Request, admin: ReturnType<typeof createClient<any>>) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Response("Authorization required.", { status: 401 });
  const { data: auth, error } = await admin.auth.getUser(token);
  if (error || !auth.user) throw new Response("Invalid authentication token.", { status: 401 });
  const { data: profile } = await admin.from("users").select("id,role,status,name,email,auth_user_id")
    .eq("auth_user_id", auth.user.id).maybeSingle();
  if (!profile || !["USER","MASTER ADMIN"].includes(String(profile.role))) {
    throw new Response("AegisPay profile not found.", { status: 404 });
  }
  if (["BLOCKED","SUSPENDED","DELETED"].includes(String(profile.status || "").toUpperCase())) {
    throw new Response("This account is not active.", { status: 403 });
  }
  return profile;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "AI support service is not configured." }, 503);

  const caseCategory = (message: string) => {
    const q = message.toLowerCase();
    if (/\b(withdraw|payout|cash.?out)\b/.test(q)) return "WITHDRAWAL";
    if (/\b(deposit|top.?up|txid|payment)\b/.test(q)) return "DEPOSIT";
    if (/\b(kyc|cnic|passport|identity|verification)\b/.test(q)) return "KYC";
    if (/\b(shop|task|cycle|checkout|settlement)\b/.test(q)) return "SHOP";
    if (/\b(login|password|username|account|profile|wallet)\b/.test(q)) return "ACCOUNT";
    if (/\b(security|hacked|unauthorized|fraud|suspicious)\b/.test(q)) return "SECURITY";
    if (/\b(error|bug|crash|not working|failed|stuck)\b/.test(q)) return "TECHNICAL";
    return "GENERAL";
  };
  async function notifySupport(admin: ReturnType<typeof createClient<any>>, profile: any, caseRow: any) {
    const bot = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const chat = Deno.env.get("TELEGRAM_CHAT_ID") || "";
    if (!bot || !chat) return false;
    try {
      const representativeRequest = caseRow.requestType === "CUSTOMER_REPRESENTATIVE";
      const res = await fetch("https://api.telegram.org/bot" + bot + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text:
          (representativeRequest ? "AegisPay Customer Representative Request" : "AegisPay AI Support Escalation") + "\n" +
          "Action required: Please contact this client and review the issue.\n" +
          "Case ID: " + caseRow.id + "\nCategory: " + caseRow.category +
          "\nClient: " + String(profile.name || profile.email || profile.id).slice(0, 100) +
          "\nContact email: " + String(profile.email || "Not available").slice(0, 120) +
          "\nStatus: " + String(caseRow.status || "OPEN") +
          "\nIssue:\n" + String(caseRow.user_message || "").slice(-900) +
          "\n\nMaster Admin: open AI Support Cases to review and resolve."
        }),
        signal: AbortSignal.timeout(4500)
      });
      const body = await res.json().catch(() => null);
      return Boolean(res.ok && body?.ok);
    } catch (_) { return false; }
  }
  async function notifyAiChat(profile: any, message: string, category: string) {
    const bot = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const chat = Deno.env.get("TELEGRAM_CHAT_ID") || "";
    if (!bot || !chat) return false;
    const preview = String(message || "").trim()
      .replace(/\b(password|passcode|pin|otp|2fa code|verification code)\b\s*(?:is|:|=|-)?\s*[^\s,;]+/gi, "$1: [redacted]")
      .replace(/\b(seed phrase|recovery phrase|private key)\b\s*(?:is|:|=|-)?\s*[\s\S]{0,240}/gi, "$1: [redacted]")
      .replace(/\b[A-Fa-f0-9]{64}\b/g, "[transaction hash hidden]")
      .replace(/\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g, "[wallet address hidden]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email hidden]")
      .slice(0, 650) || "[No text preview available]";
    const client = String(profile?.name || "Client")
      .replace(/\bAli\s+Shahid\b/gi, "Client")
      .replace(/\bMASTER[_\s-]*ADMIN\b/gi, "Client")
      .slice(0, 80);
    const text = "AegisPay Client AI Chat\n" +
      "Client: " + client + "\nCategory: " + String(category || "GENERAL") +
      "\nMessage preview (sensitive details redacted):\n" + preview +
      "\n\nOpen the Master Admin support area if follow-up is needed.";
    try {
      const res = await fetch("https://api.telegram.org/bot" + bot + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(4500)
      });
      const body = await res.json().catch(() => null);
      return Boolean(res.ok && body?.ok);
    } catch (_) {
      return false;
    }
  }

  const SUPPORT_ATTACHMENT_BUCKET = "private-support-attachments";
  const SUPPORT_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
  const SUPPORT_ATTACHMENT_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

  type SupportAttachmentUpload = { name: string; mimeType: string; bytes: Uint8Array };
  type SupportAttachmentMeta = { name: string; mimeType: string; sizeBytes: number; path: string };

  function parseSupportAttachment(value: any): SupportAttachmentUpload | null {
    if (value == null) return null;
    const mimeType = String(value.mimeType || "").toLowerCase();
    if (!SUPPORT_ATTACHMENT_MIME.has(mimeType)) throw new Response("Only JPG, PNG, WebP images and PDF files are allowed.", { status: 415 });
    const rawBase64 = String(value.base64 || "").replace(/\s+/g, "");
    if (!rawBase64 || rawBase64.length > Math.ceil(SUPPORT_ATTACHMENT_MAX_BYTES * 4 / 3) + 8 ||
        rawBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(rawBase64)) {
      throw new Response("The attachment data is invalid or too large.", { status: 413 });
    }
    let binary: string;
    try { binary = atob(rawBase64); } catch (_) { throw new Response("The attachment could not be decoded.", { status: 400 }); }
    if (!binary.length || binary.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
      throw new Response("Attachments must be between 1 byte and 3 MB.", { status: 413 });
    }
    const safeName = String(value.name || "attachment").replace(/[\\/]/g, "_").replace(/[^A-Za-z0-9._ -]/g, "_").trim().slice(0, 100) || "attachment";
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { name: safeName, mimeType, bytes };
  }

  async function saveSupportAttachment(
    admin: ReturnType<typeof createClient<any>>,
    caseId: string,
    authUserId: string,
    attachment: SupportAttachmentUpload
  ): Promise<SupportAttachmentMeta> {
    if (!authUserId) throw new Error("The authenticated account could not be confirmed.");
    const ext = attachment.mimeType === "image/jpeg" ? "jpg"
      : attachment.mimeType === "image/png" ? "png"
      : attachment.mimeType === "image/webp" ? "webp" : "pdf";
    const path = authUserId + "/" + caseId + "/" + crypto.randomUUID() + "." + ext;
    const uploadBuffer = new ArrayBuffer(attachment.bytes.byteLength);
    new Uint8Array(uploadBuffer).set(attachment.bytes);
    const { error } = await admin.storage.from(SUPPORT_ATTACHMENT_BUCKET).upload(
      path,
      new Blob([uploadBuffer], { type: attachment.mimeType }),
      { contentType: attachment.mimeType, upsert: false }
    );
    if (error) throw new Error("The attachment could not be stored securely.");
    return { name: attachment.name, mimeType: attachment.mimeType, sizeBytes: attachment.bytes.byteLength, path };
  }

  async function listSupportMessages(admin: ReturnType<typeof createClient<any>>, caseId: string) {
    const { data, error } = await admin.from("ai_support_messages")
      .select("id,case_id,sender_user_id,sender_role,message_text,created_at,attachments")
      .eq("case_id", caseId).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(250);
    if (error) throw new Error("Unable to load support conversation.");
    return await Promise.all((data || []).map(async (message: any) => {
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      const signedAttachments = await Promise.all(attachments.map(async (item: any) => {
        if (!item || typeof item.path !== "string") return { ...item, signedUrl: null };
        const { data: signed, error: signedError } = await admin.storage
          .from(SUPPORT_ATTACHMENT_BUCKET).createSignedUrl(item.path, 1800);
        return { ...item, signedUrl: signedError ? null : signed?.signedUrl || null };
      }));
      return { ...message, attachments: signedAttachments };
    }));
  }

  function isWithdrawalRequestIntent(message: string): boolean {
    return /(?:\b(?:i want|i need|please|submit|create|make|request)\b.{0,50}\b(?:withdraw|withdrawal|cash.?out|payout)\b|\b(?:withdrawal|withdraw|cash.?out)\s+(?:request|my funds|money)\b|\bwithdrawal request\b)/i.test(message);
  }

  function isSupportIssueIntent(message: string): boolean {
    return /\b(not working|doesn't work|does not work|can't|cannot|unable|failed|failure|stuck|missing|disappeared|error|bug|complaint|problem|issue|wrong|incorrect|pending too long|not showing|not appear|not received|not credited|not updated|not reflected|rejected|blocked|suspended|tried again|still not|keeps failing|need help|help me|verification delay|deposit problem|withdrawal problem)\b|\b(nahi|nahin|nhi|masla|maslay|galat|galt|nahi chal|kaam nahi|show nahi|credit nahi|receive nahi|update nahi)\b/i.test(message);
  }

  async function openSupportCase(admin: ReturnType<typeof createClient<any>>, user: any, profile: any, message: string, answer: string, requestType = "AI_ESCALATION", deferTelegram = false) {
    const subject = message.replace(/\s+/g, " ").trim().slice(0, 120) || "Client requested assistance";
    const { data, error } = await admin.from("ai_support_cases").insert({
      user_id: profile.id, auth_user_id: user.id, category: caseCategory(message),
      subject, user_message: message.slice(0, 1000), ai_answer: answer.slice(0, 2000), status: "OPEN",
      representative_requested: requestType === "CUSTOMER_REPRESENTATIVE"
    }).select("id,category,status,created_at,updated_at,representative_requested,representative_joined_at,representative_user_id,conversation_seeded_at").single();
    if (error || !data) throw new Error("Unable to create a Master Admin support case.");
    const notified = deferTelegram ? false : await notifySupport(admin, profile, { ...data, user_message: message, requestType });
    await admin.from("audit_events").insert({
      actor_user_id: null, target_user_id: profile.id, event_type: "AI_SUPPORT_CASE_OPENED",
      description: (requestType === "CUSTOMER_REPRESENTATIVE" ? "Client requested a customer representative." : "AegisPay AI escalated an unresolved client issue to support.") + " Case=" + data.id + "; category=" + data.category + "; TelegramNotified=" + String(notified) + "; TelegramDeferred=" + String(deferTelegram),
      reference_id: data.id
    });
    return { ...data, telegramNotified: notified, telegramDeferred: deferTelegram };
  }

  async function deliverToActiveLiveRepresentative(admin: ReturnType<typeof createClient<any>>, profile: any, message: string) {
    const { data: liveCase, error: findError } = await admin.from("ai_support_cases")
      .select("id,user_id,category,subject,status,representative_requested,representative_joined_at,representative_user_id,updated_at")
      .eq("user_id", profile.id).eq("representative_requested", true).eq("status", "IN_PROGRESS")
      .not("representative_joined_at", "is", null)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (findError) throw new Error("Unable to find the active representative conversation.");
    if (!liveCase) return null;
    const cleanMessage = String(message || "").trim().slice(0, 2000);
    if (!cleanMessage) return null;
    const { data: sent, error: sendError } = await admin.from("ai_support_messages").insert({
      case_id: liveCase.id, sender_user_id: profile.id, sender_role: "CLIENT", message_text: cleanMessage, attachments: []
    }).select("id,case_id,sender_user_id,sender_role,message_text,created_at,attachments").single();
    if (sendError || !sent) throw new Error("Could not add your message to the active representative conversation.");
    await admin.from("ai_support_cases").update({ updated_at: sent.created_at }).eq("id", liveCase.id);
    return { case: liveCase, message: sent };
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const profile = await actor(req, admin);
    const authorizationToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "message").toLowerCase();
    const assistantMode = body?.mode === "assistant";
    const attachmentInput = parseSupportAttachment(body?.attachment);

    if (action === "admin_list_cases" || action === "admin_update_case" || action === "admin_join_live_chat" || action === "admin_live_chat_state" || action === "admin_send_chat_message") {
      if (profile.role !== "MASTER ADMIN" || !["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
        return json({ error: "Active Master Admin access required." }, 403);
      }
      if (action === "admin_list_cases") {
        const { data: cases, error } = await admin.from("ai_support_cases")
          .select("id,user_id,category,subject,user_message,ai_answer,status,resolution,created_at,updated_at,resolved_at,representative_requested,representative_joined_at,representative_user_id,conversation_seeded_at")
          .order("created_at", { ascending: false }).limit(150);
        if (error) return json({ error: "Unable to load AI support cases." }, 500);
        const ids = Array.from(new Set((cases || []).map((x: any) => x.user_id).filter(Boolean)));
        const users = ids.length ? await admin.from("users").select("id,name,email,username").in("id", ids) : { data: [], error: null };
        if (users.error) return json({ error: "Unable to load support client labels." }, 500);
        const userMap = new Map((users.data || []).map((x: any) => [x.id, x]));
        return json({ cases: (cases || []).map((x: any) => ({ ...x, user: userMap.get(x.user_id) || null })) });
      }
      const caseId = String(body?.caseId || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) return json({ error: "Valid support case ID is required." }, 400);

      if (["admin_join_live_chat", "admin_live_chat_state", "admin_send_chat_message"].includes(action)) {
        const { data: liveCase, error: liveCaseError } = await admin.from("ai_support_cases")
          .select("id,user_id,category,subject,status,resolution,representative_requested,representative_joined_at,representative_user_id,updated_at")
          .eq("id", caseId).maybeSingle();
        if (liveCaseError) return json({ error: "Unable to load this support conversation." }, 500);
        if (!liveCase) return json({ error: "Support case not found." }, 404);
        if (!liveCase.representative_requested) return json({ error: "This case is not a live representative request." }, 409);

        if (action === "admin_live_chat_state") {
          try { return json({ case: liveCase, messages: await listSupportMessages(admin, caseId) }); }
          catch (_) { return json({ error: "Unable to load support messages." }, 500); }
        }

        if (action === "admin_join_live_chat") {
          if (!["OPEN", "IN_PROGRESS"].includes(String(liveCase.status).toUpperCase())) {
            return json({ error: "This support conversation is already resolved or closed." }, 409);
          }
          if (liveCase.representative_user_id && liveCase.representative_user_id !== profile.id) {
            return json({ error: "This conversation is already assigned to another representative." }, 409);
          }
          let joinedCase = liveCase;
          if (!liveCase.representative_joined_at) {
            const now = new Date().toISOString();
            const { data: changed, error: joinError } = await admin.from("ai_support_cases").update({
              status: "IN_PROGRESS", representative_joined_at: now,
              representative_user_id: profile.id, updated_at: now
            }).eq("id", caseId).is("representative_joined_at", null)
              .in("status", ["OPEN", "IN_PROGRESS"])
              .select("id,user_id,category,subject,status,resolution,representative_requested,representative_joined_at,representative_user_id,updated_at").maybeSingle();
            if (joinError) return json({ error: "Could not join the live conversation." }, 500);
            if (changed) {
              joinedCase = changed;
              const { error: systemMessageError } = await admin.from("ai_support_messages").insert({
                case_id: caseId, sender_user_id: null, sender_role: "SYSTEM",
                message_text: "A representative is now live in this chat."
              });
              if (systemMessageError) return json({ error: "The conversation joined, but its live notice could not be posted. Please retry." }, 500);
              await admin.from("audit_events").insert({
                actor_user_id: profile.id, target_user_id: liveCase.user_id,
                event_type: "AI_SUPPORT_REPRESENTATIVE_JOINED",
                description: "A representative joined support conversation " + caseId + ".",
                reference_id: caseId
              });
            } else {
              const { data: current } = await admin.from("ai_support_cases")
                .select("id,user_id,category,subject,status,resolution,representative_requested,representative_joined_at,representative_user_id,updated_at")
                .eq("id", caseId).maybeSingle();
              if (!current) return json({ error: "Support case not found." }, 404);
              if (current.representative_user_id && current.representative_user_id !== profile.id) {
                return json({ error: "This conversation is already assigned to another representative." }, 409);
              }
              joinedCase = current;
            }
          }
          try { return json({ ok: true, case: joinedCase, messages: await listSupportMessages(admin, caseId) }); }
          catch (_) { return json({ error: "The live conversation joined but messages could not be loaded." }, 500); }
        }

        const chatMessage = String(body?.message || "").trim().slice(0, 2000);
        if (!chatMessage) return json({ error: "Enter a message before sending." }, 400);
        if (String(liveCase.status).toUpperCase() !== "IN_PROGRESS" || !liveCase.representative_joined_at) {
          return json({ error: "Join this live conversation before sending messages." }, 409);
        }
        if (liveCase.representative_user_id && liveCase.representative_user_id !== profile.id) {
          return json({ error: "This conversation is assigned to another representative." }, 403);
        }
        const { data: sent, error: sendError } = await admin.from("ai_support_messages").insert({
          case_id: caseId, sender_user_id: profile.id, sender_role: "REPRESENTATIVE", message_text: chatMessage
        }).select("id,case_id,sender_user_id,sender_role,message_text,created_at").single();
        if (sendError || !sent) return json({ error: "Your message could not be sent. Please try again." }, 500);
        await admin.from("ai_support_cases").update({ updated_at: sent.created_at }).eq("id", caseId);
        return json({ ok: true, message: sent });
      }

      const status = String(body?.status || "").toUpperCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) return json({ error: "Valid support case ID is required." }, 400);
      if (!["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(status)) return json({ error: "Invalid support case status." }, 400);
      const resolution = String(body?.resolution || "").trim().slice(0, 1000);
      const now = new Date().toISOString();
      const { data: updated, error } = await admin.from("ai_support_cases").update({
        status, resolution: resolution || null, updated_at: now,
        resolved_at: ["RESOLVED", "CLOSED"].includes(status) ? now : null,
        resolved_by: ["RESOLVED", "CLOSED"].includes(status) ? profile.id : null
      }).eq("id", caseId).select("id,status,resolution,updated_at,resolved_at,representative_requested").maybeSingle();
      if (error || !updated) return json({ error: "Support case could not be updated." }, 500);
      if (updated.representative_requested && ["RESOLVED", "CLOSED"].includes(status)) {
        await admin.from("ai_support_messages").insert({
          case_id: caseId, sender_user_id: null, sender_role: "SYSTEM",
          message_text: status === "RESOLVED" ? "This support conversation has been marked resolved." : "This support conversation has been closed."
        });
      }
      await admin.from("audit_events").insert({
        actor_user_id: profile.id, event_type: "AI_SUPPORT_CASE_UPDATED",
        description: "Master Admin updated AI support case " + caseId + " to " + status + ".",
        reference_id: caseId
      });
      return json({ ok: true, case: updated });
    }

    if (action === "client_live_support_state" || action === "client_send_chat_message") {
      if (profile.role !== "USER" || !["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
        return json({ error: "An active client account is required to use live support." }, 403);
      }
      const caseId = String(body?.caseId || "");
      let liveCase: any = null;
      if (caseId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) {
          return json({ error: "Valid support case ID is required." }, 400);
        }
        const { data, error } = await admin.from("ai_support_cases")
          .select("id,user_id,category,subject,status,resolution,representative_requested,representative_joined_at,representative_user_id,conversation_seeded_at,created_at,updated_at")
          .eq("id", caseId).eq("user_id", profile.id).maybeSingle();
        if (error) return json({ error: "Unable to load your support conversation." }, 500);
        liveCase = data;
      } else {
        const { data, error } = await admin.from("ai_support_cases")
          .select("id,user_id,category,subject,status,resolution,representative_requested,representative_joined_at,representative_user_id,conversation_seeded_at,created_at,updated_at")
          .eq("user_id", profile.id).eq("representative_requested", true)
          .in("status", ["OPEN", "IN_PROGRESS"])
          .order("representative_joined_at", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false }).limit(1).maybeSingle();
        if (error) return json({ error: "Unable to check for an active support conversation." }, 500);
        liveCase = data;
      }
      if (!liveCase || !liveCase.representative_requested) return json({ case: null, messages: [] });
      const caseClosed = ["RESOLVED", "CLOSED"].includes(String(liveCase.status || "").toUpperCase());
      if (action === "client_live_support_state" && caseClosed) {
        // Deliberately return no Client transcript after Admin resolution. Messages remain stored
        // under the case_id, so Master Admin can still review the entire conversation.
        return json({ case: liveCase, messages: [], clientChatCleared: true });
      }
      if (action === "client_send_chat_message" && caseClosed) {
        return json({ error: "This support conversation is already resolved or closed." }, 409);
      }

      if (!liveCase.conversation_seeded_at) {
        const firstClientMessage = String(liveCase.user_message || "").trim().slice(0, 2000);
        const seedRows: any[] = [];
        if (firstClientMessage) seedRows.push({ case_id: liveCase.id, sender_user_id: profile.id, sender_role: "CLIENT", message_text: firstClientMessage });
        seedRows.push({ case_id: liveCase.id, sender_user_id: null, sender_role: "SYSTEM", message_text: "Your request has been received. A representative may contact you soon." });
        const { error: seedError } = await admin.from("ai_support_messages").insert(seedRows);
        if (seedError) return json({ error: "Your support chat could not be opened. Please retry in a moment." }, 500);
        const seededAt = new Date().toISOString();
        await admin.from("ai_support_cases").update({ conversation_seeded_at: seededAt }).eq("id", liveCase.id).is("conversation_seeded_at", null);
        liveCase.conversation_seeded_at = seededAt;
      }

      if (action === "client_send_chat_message") {
        let chatMessage = String(body?.message || "").trim().slice(0, 2000);
        if (!chatMessage && attachmentInput) chatMessage = "Shared an attachment: " + attachmentInput.name;
        if (!chatMessage) return json({ error: "Enter a message or attach a file before sending." }, 400);
        if (chatMessage.length > 250 && /^Your request has been received\.\s*A representative may contact you soon\./i.test(chatMessage)) {
          return json({ error: "This looks like the previous mixed chat transcript, not a new message. Please type only your new message; the Admin transcript is preserved." }, 400);
        }
        if (!["OPEN", "IN_PROGRESS"].includes(String(liveCase.status).toUpperCase())) {
          return json({ error: "This support conversation is already resolved or closed." }, 409);
        }
        if (chatMessage.length > 200) {
          const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
          const { data: duplicateMessage, error: duplicateError } = await admin.from("ai_support_messages")
            .select("id").eq("case_id", liveCase.id).eq("sender_user_id", profile.id)
            .eq("sender_role", "CLIENT").eq("message_text", chatMessage)
            .gte("created_at", recentCutoff).order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (duplicateError) return json({ error: "Unable to verify whether this message was already sent." }, 500);
          if (duplicateMessage) return json({ error: "This long message was already sent recently. Please send only your new message or wait for the representative." }, 409);
        }
        let stored: SupportAttachmentMeta | null = null;
        if (attachmentInput) stored = await saveSupportAttachment(admin, liveCase.id, profile.auth_user_id || "", attachmentInput);
        const { data: sent, error: sendError } = await admin.from("ai_support_messages").insert({
          case_id: liveCase.id, sender_user_id: profile.id, sender_role: "CLIENT",
          message_text: chatMessage, attachments: stored ? [stored] : []
        }).select("id,case_id,sender_user_id,sender_role,message_text,created_at,attachments").single();
        if (sendError || !sent) {
          if (stored?.path) { try { await admin.storage.from(SUPPORT_ATTACHMENT_BUCKET).remove([stored.path]); } catch (_) {} }
          return json({ error: "Your message could not be sent. Please try again." }, 500);
        }
        await admin.from("ai_support_cases").update({ updated_at: sent.created_at }).eq("id", liveCase.id);
        const hydratedMessages = await listSupportMessages(admin, liveCase.id);
        const hydrated = hydratedMessages.find((item: any) => item.id === sent.id) || sent;
        return json({ ok: true, message: hydrated });
      }

      try { return json({ case: liveCase, messages: await listSupportMessages(admin, liveCase.id) }); }
      catch (_) { return json({ error: "Unable to load your support messages." }, 500); }
    }

    if (action === "create_support_case") {
      if (profile.role !== "USER" || !["ACTIVE", "NORMAL"].includes(String(profile.status || "").toUpperCase())) {
        return json({ error: "An active client account is required to contact a representative." }, 403);
      }
      const typedMessage = String(body?.message || "").trim().slice(0, 1000);
      if (typedMessage.length < 8 && !attachmentInput) {
        return json({ error: "Please describe the issue or attach a screenshot before contacting a representative." }, 400);
      }
      const message = typedMessage || "Please review the attached file.";
      const caseMessage = attachmentInput
        ? (message + "\n[Attachment attached: " + attachmentInput.name + "]").slice(0, 1000)
        : message;
      const rawHistory = Array.isArray(body?.history) ? body.history : [];
      const history = rawHistory.map((x: any) => ({
        role: String(x?.role || ""),
        content: String(x?.content || "").trim().slice(0, 1000),
      })).filter((x: any) => ["user", "assistant"].includes(x.role) && x.content).slice(-10);
      const transcript = history.map((x: any) => (x.role === "user" ? "Client: " : "Aegis AI: ") + x.content).join("\n").slice(-1600);
      const category = caseCategory(typedMessage || message);
      const { data: activeCase, error: activeCaseError } = await admin.from("ai_support_cases")
        .select("id,user_id,auth_user_id,category,subject,user_message,ai_answer,status,created_at,representative_requested,representative_joined_at,representative_user_id,conversation_seeded_at")
        .eq("user_id", profile.id).in("status", ["OPEN", "IN_PROGRESS"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (activeCaseError) return json({ error: "Unable to check your existing support requests." }, 500);

      let supportCase: any;
      const canReuse = Boolean(activeCase && activeCase.category === category &&
        Date.now() - new Date(activeCase.created_at).getTime() < 12 * 60 * 60 * 1000);
      if (canReuse && activeCase) {
        const updatedMessage = String(activeCase.user_message || "").includes(message)
          ? String(activeCase.user_message || "").slice(0, 1000)
          : ("Previous issue: " + String(activeCase.user_message || "").slice(0, 250) +
             "\nCustomer representative request: " + caseMessage).slice(-1000);
        const updatedTranscript = (String(activeCase.ai_answer || "") +
          "\n\nCustomer representative request and recent conversation:\n" + transcript).slice(-2000);
        const now = new Date().toISOString();
        const { data: updated, error } = await admin.from("ai_support_cases").update({
          subject: message.replace(/\s+/g, " ").trim().slice(0, 120) || activeCase.subject,
          category, user_message: updatedMessage, ai_answer: updatedTranscript, updated_at: now,
          representative_requested: true
        }).eq("id", activeCase.id).select("id,category,status,created_at,updated_at,representative_requested,representative_joined_at,representative_user_id,conversation_seeded_at").single();
        if (error || !updated) return json({ error: "Your existing support request could not be updated." }, 500);
        const notified = attachmentInput ? false : await notifySupport(admin, profile, { ...updated, user_message: updatedMessage, requestType: "CUSTOMER_REPRESENTATIVE" });
        await admin.from("audit_events").insert({
          actor_user_id: null, target_user_id: profile.id, event_type: "AI_SUPPORT_REPRESENTATIVE_REQUESTED",
          description: "Client requested a representative for support case " + updated.id + "; TelegramNotified=" + String(notified) + "; TelegramDeferred=" + String(Boolean(attachmentInput)),
          reference_id: updated.id
        });
        supportCase = { ...updated, telegramNotified: notified, telegramDeferred: Boolean(attachmentInput), reused: true };
      } else {
        supportCase = await openSupportCase(
          admin, { id: profile.auth_user_id }, profile, caseMessage,
          "Client requested a customer representative. Recent conversation:\n" + transcript,
          "CUSTOMER_REPRESENTATIVE", Boolean(attachmentInput)
        );
      }

      const { data: seedCase, error: seedCaseError } = await admin.from("ai_support_cases")
        .select("id,conversation_seeded_at,user_message").eq("id", supportCase.id).single();
      if (seedCaseError || !seedCase) return json({ error: "Your support request was created, but its chat could not be opened. Please retry." }, 500);
      if (!seedCase.conversation_seeded_at) {
        const seedRows = history.map((item: any) => ({
          case_id: supportCase.id,
          sender_user_id: item.role === "user" ? profile.id : null,
          sender_role: item.role === "user" ? "CLIENT" : "AI",
          message_text: String(item.content || "").trim().slice(0, 2000),
          attachments: []
        })).filter((item: any) => item.message_text);
        const latestUserMessage = String(seedCase.user_message || caseMessage).trim().slice(0, 2000);
        if (!seedRows.some((item: any) => item.sender_role === "CLIENT" && item.message_text === latestUserMessage)) {
          seedRows.push({ case_id: supportCase.id, sender_user_id: profile.id, sender_role: "CLIENT", message_text: latestUserMessage, attachments: [] });
        }
        seedRows.push({ case_id: supportCase.id, sender_user_id: null, sender_role: "SYSTEM", message_text: "Your request has been received. A representative may contact you soon.", attachments: [] });
        const { error: seedMessagesError } = await admin.from("ai_support_messages").insert(seedRows);
        if (seedMessagesError) return json({ error: "Your request was received, but the live chat could not be prepared. Please retry in a moment." }, 500);
        const seededAt = new Date().toISOString();
        await admin.from("ai_support_cases").update({ conversation_seeded_at: seededAt }).eq("id", supportCase.id).is("conversation_seeded_at", null);
      }

      let attachmentSaved = !attachmentInput;
      if (attachmentInput) {
        let stored: SupportAttachmentMeta | null = null;
        try {
          stored = await saveSupportAttachment(admin, supportCase.id, profile.auth_user_id || "", attachmentInput);
          const { error: attachmentMessageError } = await admin.from("ai_support_messages").insert({
            case_id: supportCase.id, sender_user_id: profile.id, sender_role: "CLIENT",
            message_text: "Attached file: " + attachmentInput.name, attachments: [stored]
          });
          if (attachmentMessageError) throw new Error("Attachment message could not be saved.");
          await admin.from("ai_support_cases").update({ updated_at: new Date().toISOString() }).eq("id", supportCase.id);
          attachmentSaved = true;
        } catch (_) {
          if (stored?.path) {
            try { await admin.storage.from(SUPPORT_ATTACHMENT_BUCKET).remove([stored.path]); } catch (_) {}
          }
          attachmentSaved = false;
        }
      }
      if (attachmentInput && supportCase.telegramDeferred) {
        const telegramCase = {
          ...supportCase,
          status: supportCase.status || "OPEN",
          user_message: attachmentSaved ? caseMessage : (caseMessage + "\n[Attachment upload failed; user will retry]").slice(0, 1000),
          requestType: "CUSTOMER_REPRESENTATIVE"
        };
        const notified = await notifySupport(admin, profile, telegramCase);
        await admin.from("audit_events").insert({
          actor_user_id: null, target_user_id: profile.id, event_type: "AI_SUPPORT_ATTACHMENT_ALERT",
          description: "Telegram alert finalized for support case " + supportCase.id + "; AttachmentSaved=" + String(attachmentSaved) + "; TelegramNotified=" + String(notified),
          reference_id: supportCase.id
        });
        supportCase = { ...supportCase, telegramNotified: notified, telegramDeferred: false, attachmentSaved };
      }
      return json({
        ok: true,
        answer: attachmentInput && !attachmentSaved
          ? "Your support request was received, but the attachment could not be saved. Please attach it again in the live chat."
          : "A representative may contact you soon.",
        supportCase, attachmentSaved
      });
    }

    const { data: enabled, error: runtimeError } = await admin.rpc("app_runtime_enabled");
    if (runtimeError) return json({ error: "Unable to confirm AegisPay runtime status." }, 503);
    if (enabled !== true) return json({ error: "AegisPay is temporarily unavailable. Please try again later." }, 423);

    const message = String(body?.message || "").trim().slice(0, 1000);
    if (!message) return json({ error: "A message is required." }, 400);
    const rawHistory = Array.isArray(body?.history) ? body.history : [];
    const history = rawHistory.map((x: any) => ({
      role: String(x?.role || ""),
      content: String(x?.content || "").trim().slice(0, 1500),
    })).filter((x: any) => ["user", "assistant"].includes(x.role) && x.content).slice(-10);
    const context = await loadSupportContext(admin, profile);

    const explicitHumanSupportRequest = profile.role === "USER" && isExplicitHumanSupportRequest(message);
    const op = profile.role === "USER" ? await handleSafeOperation(admin, profile, message, context) : { handled: false };
    if (op.handled) {
      let supportCase = null;
      const opAnswer = String(op.answer || fallback(message, context, history));
      const withdrawalRequest = profile.role === "USER" && isWithdrawalRequestIntent(message);
      const needsRepresentative = profile.role === "USER" &&
        (Boolean(op.needsEscalation) || explicitHumanSupportRequest);
      if (needsRepresentative) {
        if (!assistantMode) {
          try {
            const activeDelivery = await deliverToActiveLiveRepresentative(admin, profile, message);
            if (activeDelivery) return json({
              configured: false, provider: "aegispay-guidance",
              answer: "Your message has been added to the representative conversation already open in your Client chat.",
              degraded: false, role: profile.role, supportCase: activeDelivery.case,
              message: activeDelivery.message, routedToRepresentative: true
            });
          } catch (_) {
            return json({ error: "Your message could not be added to the active representative conversation." }, 503);
          }
        }
        try {
          supportCase = await openSupportCase(
            admin, { id: profile.auth_user_id }, profile, message,
            withdrawalRequest
              ? "Client submitted a withdrawal-related request. Admin review is required; no automatic payout has been initiated."
              : opAnswer,
            explicitHumanSupportRequest ? "CUSTOMER_REPRESENTATIVE" : "AI_ESCALATION"
          );
        } catch (_) {
          return json({ configured: false, provider: "aegispay-guidance", answer: sanitizeClientAnswer(opAnswer + "\n\nWe could not notify support automatically. Please tap Talk to a Customer Representative and retry."), supportCaseError: true, degraded: false }, 200);
        }
      }
      const responseText = withdrawalRequest
        ? "Withdrawal requests must be submitted through the secure Withdrawals workflow. This assistant cannot approve or initiate a payout. Review the displayed fee and net amount there before confirming." +
          (supportCase ? "\n\nA representative may contact you soon." : "")
        : opAnswer + (supportCase ? "\n\nA representative may contact you soon." : "");
      if (profile.role === "USER" && !needsRepresentative) {
        await notifyAiChat(profile, message, caseCategory(message));
      }
      return json({ configured: false, provider: "aegispay-guidance", answer: sanitizeClientAnswer(responseText), degraded: false, supportCase });
    }

    let answer = fallback(message, context, history);
    let configured = false;
    let provider = "aegispay-guidance";
    let degraded = false;

    let supportCase = null;
    const withdrawalRequest = profile.role === "USER" && isWithdrawalRequestIntent(message);

    // Don't spend a model request on an explicit human handoff or payout action.
    // Neither category should notify Admin unless the client asked for a human or
    // there is a concrete, unresolved customer issue.
    if (!withdrawalRequest && !explicitHumanSupportRequest) {
      try {
        const generated = await requestAegisAI({
          authorizationToken,
          message,
          history,
          context,
        });
        const safeGenerated = sanitizeClientAnswer(generated);
        if (safeGenerated) {
          answer = safeGenerated;
          configured = true;
          provider = "cloudflare-workers-ai";
        } else {
          degraded = true;
        }
      } catch (_) {
        degraded = true;
      }
    } else if (withdrawalRequest) {
      answer = "Withdrawal requests must be submitted through the secure Withdrawals workflow. This assistant cannot approve or initiate a payout. Review the displayed fee and net amount there before confirming.";
    } else {
      answer = "I'll pass this to a customer representative.";
    }

    const needsEscalation = profile.role === "USER" && (
      explicitHumanSupportRequest ||
      shouldEscalateUnresolvedIssue({ message, answer, degraded })
    );
    if (needsEscalation) {
      // If a legacy client is already in representative mode, route to that existing
      // case. Normal AI Assistant messages never create a case unless a human is
      // explicitly requested or the issue cannot be resolved.
      if (!assistantMode) {
        try {
          const activeDelivery = await deliverToActiveLiveRepresentative(admin, profile, message);
          if (activeDelivery) return json({
            configured, provider,
            answer: "Your message has been added to the representative conversation already open in your Client chat.",
            degraded, role: profile.role, supportCase: activeDelivery.case,
            message: activeDelivery.message, routedToRepresentative: true
          });
        } catch (_) {
          return json({ error: "Your message could not be added to the active representative conversation." }, 503);
        }
      }
      try {
        supportCase = await openSupportCase(
          admin, { id: profile.auth_user_id }, profile, message,
          withdrawalRequest
            ? "Client submitted a withdrawal-related request. Admin review is required; no automatic payout has been initiated."
            : answer,
          explicitHumanSupportRequest ? "CUSTOMER_REPRESENTATIVE" : "AI_ESCALATION"
        );
        if (withdrawalRequest) {
          answer = "Withdrawal requests must be submitted through the secure Withdrawals workflow. This assistant cannot approve or initiate a payout. A representative may contact you soon.";
        } else if (!explicitHumanSupportRequest) {
          answer += "\n\nA representative may contact you soon.";
        }
      } catch (_) {
        answer += "\n\nI could not notify the support team automatically. Please tap Talk to a Customer Representative and retry.";
      }
    }
    if (profile.role === "USER" && !needsEscalation) {
      await notifyAiChat(profile, message, caseCategory(message));
    }
    return json({ configured, provider, answer: sanitizeClientAnswer(answer), degraded, role: profile.role, supportCase });
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, error.status);
    return json({ error: "AI support is temporarily unavailable." }, 503);
  }
});

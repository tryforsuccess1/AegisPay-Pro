import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL"), SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TRONGRID_KEY=Deno.env.get("TRONGRID_API_KEY"), CRON_SECRET=Deno.env.get("AEGIS_CRON_SECRET");
const MAINNET_PAYOUT_KEY=Deno.env.get("TRON_PAYOUT_PRIVATE_KEY"), TESTNET_PAYOUT_KEY=Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY");
const AI_ENDPOINT=Deno.env.get("AI_REVIEW_ENDPOINT"), AI_KEY=Deno.env.get("AI_REVIEW_API_KEY"), AI_MODEL=Deno.env.get("AI_REVIEW_MODEL");
const TELEGRAM_TOKEN=Deno.env.get("TELEGRAM_BOT_TOKEN");
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed."},405);
 if(!SUPABASE_URL||!SERVICE_KEY)return json({error:"Production readiness service is not configured."},503);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return json({error:"Authorization required."},401);
  const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authResult,error:authError}=await admin.auth.getUser(token);
  if(authError||!authResult.user)return json({error:"Invalid authentication token."},401);
  const {data:profile,error:profileError}=await admin.from("users").select("id,role,status").eq("auth_user_id",authResult.user.id).maybeSingle();
  if(profileError||!profile)return json({error:"AegisPay profile not found."},404);
  if(profile.role!=="MASTER ADMIN"||!["ACTIVE","NORMAL"].includes(String(profile.status||"").toUpperCase()))return json({error:"Active Master Admin access is required."},403);

  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  const action=String(body.action||"read").toLowerCase();

  const [{data:systemRow},{data:depositRow},{data:prodRow},{data:runtimeRow}]=await Promise.all([
   admin.from("platform_settings").select("value_json").eq("key","system_mode").maybeSingle(),
   admin.from("platform_settings").select("value_json").eq("key","deposit_rules").maybeSingle(),
   admin.from("platform_settings").select("value_json").eq("key","production_config").maybeSingle(),
   admin.from("platform_settings").select("value_json").eq("key","app_runtime").maybeSingle()
  ]);
  const system=systemRow?.value_json||{},deposit=depositRow?.value_json||{},prod=prodRow?.value_json||{};
  const network=String(deposit.network||"").toUpperCase(), receiving=String(deposit.receiving_address||"").trim();
  const environment=String(prod.environment||"PRE_PRODUCTION").toUpperCase();
  const liveDeposits=system.live_deposits===true, realPayouts=system.real_payouts===true, goLive=system.production_go_live_approved===true;
  const productionLiveDeposits=prod.live_deposits_enabled===true, productionRealPayouts=prod.real_payouts_enabled===true, productionGoLive=prod.go_live_approved===true;
  const payoutsLocked=prod.payouts_locked!==false, runtimeEnabled=runtimeRow?.value_json?.enabled===true;
  const configurationConsistent=liveDeposits===Boolean(prod.live_deposits_enabled)&&realPayouts===Boolean(prod.real_payouts_enabled)&&goLive===Boolean(prod.go_live_approved);
  const secrets={
   supabase_service_role:Boolean(SERVICE_KEY),trongrid_api:Boolean(TRONGRID_KEY),cron_secret:Boolean(CRON_SECRET),
   mainnet_payout_key:Boolean(MAINNET_PAYOUT_KEY),testnet_payout_key:Boolean(TESTNET_PAYOUT_KEY),
   ai_review_endpoint:Boolean(AI_ENDPOINT),ai_review_api_key:Boolean(AI_KEY),ai_review_model:Boolean(AI_MODEL),telegram_bot_token:Boolean(TELEGRAM_TOKEN)
  };
  const mainnetBaseConfigOk=system.mode==="MAINNET"&&network==="TRON MAINNET"&&Boolean(receiving);
  const mainnetMonitoringReady=mainnetBaseConfigOk&&liveDeposits&&productionLiveDeposits&&secrets.trongrid_api&&secrets.cron_secret;
  const mainnetPayoutGateOk=mainnetBaseConfigOk&&realPayouts&&productionRealPayouts&&goLive&&productionGoLive&&!payoutsLocked&&runtimeEnabled;
  const mainnetPayoutOperational=mainnetPayoutGateOk&&secrets.trongrid_api&&secrets.mainnet_payout_key&&secrets.telegram_bot_token;

  if(action==="update"){
    const env=String(body.environment||"PRE_PRODUCTION").toUpperCase();
    const live=body.liveDepositsEnabled===true;
    const payouts=body.realPayoutsEnabled===true;
    const approved=body.goLiveApproved===true;
    const locked=body.payoutsLocked!==false;

    if(payouts && (!mainnetPayoutOperational || !runtimeEnabled)){
      return json({error:"Production payout operations are not ready. Configure the required server-side payout, TRONGrid and Telegram secrets and complete the readiness checks first.",code:"PRODUCTION_PAYOUT_NOT_READY"},409);
    }
    if(live && env==="PRODUCTION" && (!mainnetMonitoringReady || !runtimeEnabled)){
      return json({error:"Production live-deposit monitoring is not ready. Configure TRONGrid and cron authentication before enabling production live deposits.",code:"PRODUCTION_DEPOSIT_MONITORING_NOT_READY"},409);
    }

    const userScoped=createClient(SUPABASE_URL,SERVICE_KEY,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:"Bearer "+token}}
    });
    const {data:updated,error:updateError}=await userScoped.rpc("set_production_config",{
      p_environment:env,
      p_live_deposits_enabled:live,
      p_real_payouts_enabled:payouts,
      p_go_live_approved:approved,
      p_payouts_locked:locked
    });
    if(updateError)return json({error:String(updateError.message||"Production configuration could not be saved."),code:"PRODUCTION_CONFIG_UPDATE_FAILED"},409);
    return json({status:"PRODUCTION_CONFIG_UPDATED",readiness:updated||null},200);
  }

  const readiness={
   environment,system_mode:String(system.mode||"").toUpperCase(),system_status:String(system.status||""),network,
   receiving_address_configured:Boolean(receiving),live_deposits:liveDeposits,real_payouts:realPayouts,production_go_live_approved:goLive,payouts_locked:payoutsLocked,
   production_config_live_deposits:Boolean(prod.live_deposits_enabled),production_config_real_payouts:Boolean(prod.real_payouts_enabled),
   production_config_go_live_approved:Boolean(prod.go_live_approved),runtime_enabled:runtimeEnabled,configuration_consistent:configurationConsistent,
   mainnet_base_config_ok:mainnetBaseConfigOk,mainnet_deposit_gate_ok:mainnetBaseConfigOk&&liveDeposits&&productionLiveDeposits,mainnet_payout_gate_ok:mainnetPayoutGateOk,
   server_side_secrets_required:true,cron_secret_required_for_monitoring:true
  };
  return json({readiness,secrets,mainnet_monitoring_ready:mainnetMonitoringReady,mainnet_payout_operational:mainnetPayoutOperational,checked_at:new Date().toISOString()});
 }catch(error){return json({error:String((error as Error)?.message||error).slice(0,500)},500);}
});
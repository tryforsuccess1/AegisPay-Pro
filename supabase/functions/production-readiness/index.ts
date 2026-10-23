import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TronWeb } from "npm:tronweb@6.0.4";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL"), SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TRONGRID_KEY=Deno.env.get("TRONGRID_API_KEY"), CRON_SECRET=Deno.env.get("AEGIS_CRON_SECRET");
const MAINNET_PAYOUT_KEY = Deno.env.get("TRON_MAINNET_TREASURY_PRIVATE_KEY") || Deno.env.get("TRON_PAYOUT_PRIVATE_KEY") || "";
const TESTNET_PAYOUT_KEY = Deno.env.get("TRON_SHASTA_TREASURY_PRIVATE_KEY") || Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY") || "";
const MAINNET_TREASURY_KEY_ALIAS = Deno.env.get("TRON_MAINNET_TREASURY_PRIVATE_KEY") || "";
const MAINNET_PAYOUT_FALLBACK_KEY = Deno.env.get("TRON_PAYOUT_PRIVATE_KEY") || "";
const SHASTA_TREASURY_KEY_ALIAS = Deno.env.get("TRON_SHASTA_TREASURY_PRIVATE_KEY") || "";
const SHASTA_PAYOUT_FALLBACK_KEY = Deno.env.get("TRON_TESTNET_PAYOUT_PRIVATE_KEY") || "";
const MAINNET_HD_MNEMONIC = Deno.env.get("TRON_MAINNET_CHILD_HD_MNEMONIC") || Deno.env.get("TRON_HD_WALLET_MNEMONIC") || "";
const SHASTA_HD_MNEMONIC = Deno.env.get("TRON_SHASTA_CHILD_HD_MNEMONIC") || Deno.env.get("TRON_TESTNET_HD_WALLET_MNEMONIC") || "";
const MAINNET_HD_MNEMONIC_PRIMARY = Deno.env.get("TRON_MAINNET_CHILD_HD_MNEMONIC") || "";
const MAINNET_HD_MNEMONIC_FALLBACK = Deno.env.get("TRON_HD_WALLET_MNEMONIC") || "";
const SHASTA_HD_MNEMONIC_PRIMARY = Deno.env.get("TRON_SHASTA_CHILD_HD_MNEMONIC") || "";
const SHASTA_HD_MNEMONIC_FALLBACK = Deno.env.get("TRON_TESTNET_HD_WALLET_MNEMONIC") || "";
const MAINNET_HD_PASSPHRASE = Deno.env.get("TRON_MAINNET_CHILD_HD_PASSPHRASE") || Deno.env.get("TRON_HD_WALLET_PASSPHRASE") || "";
const SHASTA_HD_PASSPHRASE = Deno.env.get("TRON_SHASTA_CHILD_HD_PASSPHRASE") || Deno.env.get("TRON_TESTNET_HD_WALLET_PASSPHRASE") || "";
const MAINNET_HD_PASSPHRASE_PRIMARY = Deno.env.get("TRON_MAINNET_CHILD_HD_PASSPHRASE") || "";
const MAINNET_HD_PASSPHRASE_FALLBACK = Deno.env.get("TRON_HD_WALLET_PASSPHRASE") || "";
const SHASTA_HD_PASSPHRASE_PRIMARY = Deno.env.get("TRON_SHASTA_CHILD_HD_PASSPHRASE") || "";
const SHASTA_HD_PASSPHRASE_FALLBACK = Deno.env.get("TRON_TESTNET_HD_WALLET_PASSPHRASE") || "";
const SHASTA_USDT_CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const AI_ENDPOINT=Deno.env.get("AI_REVIEW_ENDPOINT"), AI_KEY=Deno.env.get("AI_REVIEW_API_KEY"), AI_MODEL=Deno.env.get("AI_REVIEW_MODEL");
const TELEGRAM_TOKEN=Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID=Deno.env.get("TELEGRAM_CHAT_ID"), TELEGRAM_APPROVER_IDS=(Deno.env.get("TELEGRAM_APPROVER_IDS")||"").split(/[\s,]+/).filter((x)=>/^[0-9]{1,20}$/.test(x));
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const normalizedKey=(value:string)=>String(value||"").trim().toLowerCase();
const normalizedMnemonic=(value:string)=>String(value||"").trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
function signerAddressCheck(privateKey:string, configuredAddress:string) {
 if(!privateKey)return {status:"MISSING_KEY",matches:false};
 if(!configuredAddress)return {status:"MISSING_TREASURY_ADDRESS",matches:false};
 try {
  const derivedAddress=TronWeb.address.fromPrivateKey(privateKey);
  if(!derivedAddress)return {status:"INVALID_PRIVATE_KEY",matches:false};
  const matches=derivedAddress===configuredAddress;
  return {status:matches?"MATCH":"MISMATCH",matches};
 } catch {
  return {status:"INVALID_PRIVATE_KEY",matches:false};
 }
}
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

  const [{data:systemRow},{data:depositRow},{data:prodRow},{data:runtimeRow},{data:shastaRulesRow}]=await Promise.all([
   admin.from("platform_settings").select("value_json").eq("key","system_mode").maybeSingle(),
   admin.from("platform_settings").select("value_json").eq("key","deposit_rules").maybeSingle(),
   admin.from("platform_settings").select("value_json").eq("key","production_config").maybeSingle(),
   admin.from("platform_settings").select("value_json").eq("key","app_runtime").maybeSingle(),
   admin.from("platform_settings").select("value_json").eq("key","shasta_testnet_rules").maybeSingle()
  ]);
  const system=systemRow?.value_json||{},deposit=depositRow?.value_json||{},prod=prodRow?.value_json||{},shastaRules=shastaRulesRow?.value_json||{};
  const network=String(deposit.network||"").toUpperCase(), receiving=String(deposit.receiving_address||"").trim();
  const mainnetTokenContract=String(deposit.token_contract||"").trim();
  const mainnetUsdtContractOk=mainnetTokenContract==="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const shastaReceiving=String(shastaRules.receiving_address||"").trim();
  const shastaRulesConfigOk=String(shastaRules.network||"").toUpperCase()==="TRON TESTNET"
   &&String(shastaRules.token_contract||"").trim()===SHASTA_USDT_CONTRACT
   &&/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(shastaReceiving);
  const mainnetSignerCheck=signerAddressCheck(MAINNET_PAYOUT_KEY,receiving);
  const shastaSignerCheck=signerAddressCheck(TESTNET_PAYOUT_KEY,shastaReceiving);
  const mainnetAliasConflict=Boolean(MAINNET_TREASURY_KEY_ALIAS&&MAINNET_PAYOUT_FALLBACK_KEY
   &&normalizedKey(MAINNET_TREASURY_KEY_ALIAS)!==normalizedKey(MAINNET_PAYOUT_FALLBACK_KEY));
  const shastaAliasConflict=Boolean(SHASTA_TREASURY_KEY_ALIAS&&SHASTA_PAYOUT_FALLBACK_KEY
   &&normalizedKey(SHASTA_TREASURY_KEY_ALIAS)!==normalizedKey(SHASTA_PAYOUT_FALLBACK_KEY));
  const mainnetHdMnemonicAliasConflict=Boolean(MAINNET_HD_MNEMONIC_PRIMARY&&MAINNET_HD_MNEMONIC_FALLBACK
   &&normalizedMnemonic(MAINNET_HD_MNEMONIC_PRIMARY)!==normalizedMnemonic(MAINNET_HD_MNEMONIC_FALLBACK));
  const shastaHdMnemonicAliasConflict=Boolean(SHASTA_HD_MNEMONIC_PRIMARY&&SHASTA_HD_MNEMONIC_FALLBACK
   &&normalizedMnemonic(SHASTA_HD_MNEMONIC_PRIMARY)!==normalizedMnemonic(SHASTA_HD_MNEMONIC_FALLBACK));
  const mainnetHdPassphraseAliasConflict=Boolean(MAINNET_HD_PASSPHRASE_PRIMARY&&MAINNET_HD_PASSPHRASE_FALLBACK
   &&MAINNET_HD_PASSPHRASE_PRIMARY!==MAINNET_HD_PASSPHRASE_FALLBACK);
  const shastaHdPassphraseAliasConflict=Boolean(SHASTA_HD_PASSPHRASE_PRIMARY&&SHASTA_HD_PASSPHRASE_FALLBACK
   &&SHASTA_HD_PASSPHRASE_PRIMARY!==SHASTA_HD_PASSPHRASE_FALLBACK);
  const mainnetShastaSelectedKeysDistinct=Boolean(MAINNET_PAYOUT_KEY&&TESTNET_PAYOUT_KEY)
   &&normalizedKey(MAINNET_PAYOUT_KEY)!==normalizedKey(TESTNET_PAYOUT_KEY);
  const mainnetShastaHdMnemonicsDistinct=Boolean(MAINNET_HD_MNEMONIC&&SHASTA_HD_MNEMONIC)
   &&normalizedMnemonic(MAINNET_HD_MNEMONIC)!==normalizedMnemonic(SHASTA_HD_MNEMONIC);
  const mainnetHdMnemonicSourceAlias=MAINNET_HD_MNEMONIC_PRIMARY?"TRON_MAINNET_CHILD_HD_MNEMONIC":MAINNET_HD_MNEMONIC_FALLBACK?"TRON_HD_WALLET_MNEMONIC":"NONE";
  const shastaHdMnemonicSourceAlias=SHASTA_HD_MNEMONIC_PRIMARY?"TRON_SHASTA_CHILD_HD_MNEMONIC":SHASTA_HD_MNEMONIC_FALLBACK?"TRON_TESTNET_HD_WALLET_MNEMONIC":"NONE";
  const mainnetHdPassphraseSourceAlias=MAINNET_HD_PASSPHRASE_PRIMARY?"TRON_MAINNET_CHILD_HD_PASSPHRASE":MAINNET_HD_PASSPHRASE_FALLBACK?"TRON_HD_WALLET_PASSPHRASE":"NONE";
  const shastaHdPassphraseSourceAlias=SHASTA_HD_PASSPHRASE_PRIMARY?"TRON_SHASTA_CHILD_HD_PASSPHRASE":SHASTA_HD_PASSPHRASE_FALLBACK?"TRON_TESTNET_HD_WALLET_PASSPHRASE":"NONE";
  const treasuryAddressesDistinct=Boolean(receiving&&shastaReceiving)&&receiving!==shastaReceiving;
  const mainnetKeySourceAlias=MAINNET_TREASURY_KEY_ALIAS?"TRON_MAINNET_TREASURY_PRIVATE_KEY":MAINNET_PAYOUT_FALLBACK_KEY?"TRON_PAYOUT_PRIVATE_KEY":"NONE";
  const shastaKeySourceAlias=SHASTA_TREASURY_KEY_ALIAS?"TRON_SHASTA_TREASURY_PRIVATE_KEY":SHASTA_PAYOUT_FALLBACK_KEY?"TRON_TESTNET_PAYOUT_PRIVATE_KEY":"NONE";
  // Diagnostics disclose only presence/status and selected alias names, never key values or derived addresses.
  const keyDiagnostics={
   mainnet_primary_alias_present:Boolean(MAINNET_TREASURY_KEY_ALIAS),
   mainnet_fallback_alias_present:Boolean(MAINNET_PAYOUT_FALLBACK_KEY),
   mainnet_selected_key_alias:mainnetKeySourceAlias,
   mainnet_alias_conflict:mainnetAliasConflict,
   mainnet_signer_address_match_status:mainnetSignerCheck.status,
   mainnet_signer_matches_configured_treasury:mainnetSignerCheck.matches,
   shasta_primary_alias_present:Boolean(SHASTA_TREASURY_KEY_ALIAS),
   shasta_fallback_alias_present:Boolean(SHASTA_PAYOUT_FALLBACK_KEY),
   shasta_selected_key_alias:shastaKeySourceAlias,
   shasta_alias_conflict:shastaAliasConflict,
   shasta_rules_configured:shastaRulesConfigOk,
   shasta_signer_address_match_status:shastaSignerCheck.status,
   shasta_signer_matches_configured_treasury:shastaSignerCheck.matches,
   mainnet_hd_mnemonic_primary_alias_present:Boolean(MAINNET_HD_MNEMONIC_PRIMARY),
   mainnet_hd_mnemonic_fallback_alias_present:Boolean(MAINNET_HD_MNEMONIC_FALLBACK),
   mainnet_hd_mnemonic_selected_alias:mainnetHdMnemonicSourceAlias,
   mainnet_hd_mnemonic_alias_conflict:mainnetHdMnemonicAliasConflict,
   shasta_hd_mnemonic_primary_alias_present:Boolean(SHASTA_HD_MNEMONIC_PRIMARY),
   shasta_hd_mnemonic_fallback_alias_present:Boolean(SHASTA_HD_MNEMONIC_FALLBACK),
   shasta_hd_mnemonic_selected_alias:shastaHdMnemonicSourceAlias,
   shasta_hd_mnemonic_alias_conflict:shastaHdMnemonicAliasConflict,
   mainnet_shasta_hd_mnemonics_distinct:mainnetShastaHdMnemonicsDistinct,
   mainnet_hd_passphrase_present:Boolean(MAINNET_HD_PASSPHRASE),
   mainnet_hd_passphrase_primary_alias_present:Boolean(MAINNET_HD_PASSPHRASE_PRIMARY),
   mainnet_hd_passphrase_fallback_alias_present:Boolean(MAINNET_HD_PASSPHRASE_FALLBACK),
   mainnet_hd_passphrase_selected_alias:mainnetHdPassphraseSourceAlias,
   mainnet_hd_passphrase_alias_conflict:mainnetHdPassphraseAliasConflict,
   shasta_hd_passphrase_present:Boolean(SHASTA_HD_PASSPHRASE),
   shasta_hd_passphrase_primary_alias_present:Boolean(SHASTA_HD_PASSPHRASE_PRIMARY),
   shasta_hd_passphrase_fallback_alias_present:Boolean(SHASTA_HD_PASSPHRASE_FALLBACK),
   shasta_hd_passphrase_selected_alias:shastaHdPassphraseSourceAlias,
   shasta_hd_passphrase_alias_conflict:shastaHdPassphraseAliasConflict,
   mainnet_shasta_selected_keys_distinct:mainnetShastaSelectedKeysDistinct,
   mainnet_shasta_treasury_addresses_distinct:treasuryAddressesDistinct,
  };
  const payoutKeysSafelySeparated= !mainnetAliasConflict&&!shastaAliasConflict
   &&mainnetShastaSelectedKeysDistinct&&treasuryAddressesDistinct&&shastaRulesConfigOk
   &&mainnetSignerCheck.matches&&shastaSignerCheck.matches;
  const networkSecretsSafelySeparated=payoutKeysSafelySeparated
   &&!mainnetHdMnemonicAliasConflict&&!shastaHdMnemonicAliasConflict
   &&!mainnetHdPassphraseAliasConflict&&!shastaHdPassphraseAliasConflict
   &&mainnetShastaHdMnemonicsDistinct;
  const environment=String(prod.environment||"PRE_PRODUCTION").toUpperCase();
  const liveDeposits=system.live_deposits===true, realPayouts=system.real_payouts===true, goLive=system.production_go_live_approved===true;
  const productionLiveDeposits=prod.live_deposits_enabled===true, productionRealPayouts=prod.real_payouts_enabled===true, productionGoLive=prod.go_live_approved===true;
  const payoutsLocked=prod.payouts_locked!==false, runtimeEnabled=runtimeRow?.value_json?.enabled===true;
  const configurationConsistent=liveDeposits===Boolean(prod.live_deposits_enabled)&&realPayouts===Boolean(prod.real_payouts_enabled)&&goLive===Boolean(prod.go_live_approved);
  const secrets={
   supabase_service_role:Boolean(SERVICE_KEY),trongrid_api:Boolean(TRONGRID_KEY),cron_secret:Boolean(CRON_SECRET),
   mainnet_payout_key:Boolean(MAINNET_PAYOUT_KEY),testnet_payout_key:Boolean(TESTNET_PAYOUT_KEY),
   ai_review_endpoint:Boolean(AI_ENDPOINT),ai_review_api_key:Boolean(AI_KEY),ai_review_model:Boolean(AI_MODEL),telegram_bot_token:Boolean(TELEGRAM_TOKEN),telegram_chat:Boolean(TELEGRAM_CHAT_ID),telegram_approvers:TELEGRAM_APPROVER_IDS.length>0
  };
   const unresolvedPayoutResult=await admin.from("withdrawal_requests").select("id,status,amount,net_amount,created_at,payout_started_at,payout_txid").in("status",["APPROVED","PROCESSING"]).is("payout_txid",null).order("created_at",{ascending:true}).limit(200);
   const unresolvedPayouts=unresolvedPayoutResult.data||[];
   const unresolvedPayoutsClear=!unresolvedPayoutResult.error&&unresolvedPayouts.length===0;
  const mainnetBaseConfigOk=system.mode==="MAINNET"&&network==="TRON MAINNET"&&/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(receiving)&&mainnetUsdtContractOk;
   // Separate current gate status from static prerequisites so an OFF/LOCKED environment can pass preflight.
   const mainnetPayoutEnablementReady=mainnetBaseConfigOk&&networkSecretsSafelySeparated&&secrets.trongrid_api&&secrets.mainnet_payout_key&&secrets.telegram_bot_token&&secrets.telegram_chat&&secrets.telegram_approvers&&runtimeEnabled&&unresolvedPayoutsClear;
   const mainnetPayoutGateOk=environment==="PRODUCTION"&&mainnetBaseConfigOk&&realPayouts&&productionRealPayouts&&goLive&&productionGoLive&&!payoutsLocked&&runtimeEnabled;
   const mainnetDepositEnablementReady=mainnetBaseConfigOk&&secrets.trongrid_api&&secrets.cron_secret&&runtimeEnabled&&mainnetPayoutEnablementReady;
   const mainnetMonitoringReady=mainnetBaseConfigOk&&liveDeposits&&productionLiveDeposits&&mainnetPayoutGateOk&&secrets.trongrid_api&&secrets.cron_secret&&mainnetPayoutEnablementReady;
   const mainnetPayoutOperational=mainnetPayoutGateOk&&networkSecretsSafelySeparated&&secrets.trongrid_api&&secrets.mainnet_payout_key&&secrets.telegram_bot_token&&secrets.telegram_chat&&secrets.telegram_approvers;

  if(action==="update"){
    const env=String(body.environment||"PRE_PRODUCTION").toUpperCase();
    const live=body.liveDepositsEnabled===true;
    const payouts=body.realPayoutsEnabled===true;
    const approved=body.goLiveApproved===true;
    const locked=body.payoutsLocked!==false;

     if(payouts && (unresolvedPayoutResult.error || unresolvedPayouts.length>0)){
       return json({error:"Cannot open live payouts until all previously approved or processing withdrawals without a TXID are reconciled.",code:"UNRECONCILED_APPROVED_PAYOUTS",unresolved_payouts:unresolvedPayouts.map((x:any)=>({id:x.id,status:x.status,amount:x.amount,net_amount:x.net_amount,created_at:x.created_at,payout_started_at:x.payout_started_at}))},409);
     }
    if(payouts && (env!=="PRODUCTION" || !approved || locked || !mainnetPayoutEnablementReady)){
      return json({error:"Production payout operations are not ready. Configure the required server-side payout, TRONGrid and Telegram secrets and complete the readiness checks first.",code:"PRODUCTION_PAYOUT_NOT_READY"},409);
    }
    if(live && (env!=="PRODUCTION" || !approved || !payouts || locked || !mainnetPayoutEnablementReady)){
      return json({error:"Live Mainnet deposits must remain paused until production is approved and real payouts are configured, reconciled, and unlocked.",code:"PRODUCTION_DEPOSITS_REQUIRE_PAYOUT_READINESS"},409);
    }
    if(live && env==="PRODUCTION" && !mainnetDepositEnablementReady){
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
   mainnet_base_config_ok:mainnetBaseConfigOk,mainnet_usdt_contract_ok:mainnetUsdtContractOk,mainnet_deposit_gate_ok:mainnetBaseConfigOk&&liveDeposits&&productionLiveDeposits&&mainnetPayoutGateOk&&mainnetDepositEnablementReady,mainnet_payout_gate_ok:mainnetPayoutGateOk,
   server_side_secrets_required:true,cron_secret_required_for_monitoring:true
  };
   return json({readiness,secrets,key_diagnostics:keyDiagnostics,payout_keys_safely_separated:payoutKeysSafelySeparated,network_secrets_safely_separated:networkSecretsSafelySeparated,mainnet_usdt_contract_ok:mainnetUsdtContractOk,mainnet_monitoring_ready:mainnetMonitoringReady,mainnet_deposit_enablement_ready:mainnetDepositEnablementReady,mainnet_payout_enablement_ready:mainnetPayoutEnablementReady,mainnet_payout_operational:mainnetPayoutOperational,unresolved_payouts:unresolvedPayouts.map((x:any)=>({id:x.id,status:x.status,amount:x.amount,net_amount:x.net_amount,created_at:x.created_at,payout_started_at:x.payout_started_at})),unresolved_payouts_clear:unresolvedPayoutsClear,checked_at:new Date().toISOString()});
 }catch(error){return json({error:String((error as Error)?.message||error).slice(0,500)},500);}
});
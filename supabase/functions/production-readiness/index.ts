import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TronWeb } from "npm:tronweb@6.0.4";
import { deriveTronHdIdentity } from "../_shared/tron-hd-wallet.ts";
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
const MAINNET_WITHDRAWAL_PAYOUT_MODE = Deno.env.get("TRON_MAINNET_WITHDRAWAL_PAYOUT_MODE") || "DISABLED";
const MAINNET_WITHDRAWAL_HD_MNEMONIC = Deno.env.get("TRON_MAINNET_WITHDRAWAL_HD_MNEMONIC") || "";
const MAINNET_WITHDRAWAL_HD_PASSPHRASE = Deno.env.get("TRON_MAINNET_WITHDRAWAL_HD_PASSPHRASE") || "";
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
async function withdrawalPayoutHdStatus(mnemonic:string,passphrase:string) {
  if(!String(mnemonic||"").trim())return {rootDerivationValid:false,childDerivationValid:false,rootFingerprintConsistent:false};
  let root:any=null,child:any=null;
  try {
    root=await deriveTronHdIdentity(mnemonic,passphrase,0);
    child=await deriveTronHdIdentity(mnemonic,passphrase,1);
    return {
      rootDerivationValid:/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(root.address||"")),
      childDerivationValid:/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(child.address||""))
        &&/^[a-fA-F0-9]{64}$/.test(String(child.privateKey||""))
        &&TronWeb.address.fromPrivateKey(child.privateKey)===child.address,
      rootFingerprintConsistent:Boolean(root.rootFingerprint)&&root.rootFingerprint===child.rootFingerprint,
    };
  } catch {
    return {rootDerivationValid:false,childDerivationValid:false,rootFingerprintConsistent:false};
  } finally {
    root=null;child=null;
  }
}

async function hdRootFingerprintStatus(admin:any, network:string, mnemonic:string, passphrase:string) {
  const normalizedMnemonic=String(mnemonic||"").trim().replace(/\s+/g," ");
  if(!normalizedMnemonic)return {status:"SECRET_MISSING",matches:null,active_wallet_count:0,root_derivation_valid:false,child_derivation_valid:false};
  const normalizedPassphrase=String(passphrase||"");
  let rootAddress="";
  try {
    const account=TronWeb.fromMnemonic(normalizedMnemonic,"m/44'/195'/0'/0/0",normalizedPassphrase);
    rootAddress=String(account.address||"");
    if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(rootAddress))return {status:"DERIVATION_FAILED",matches:null,active_wallet_count:null,root_derivation_valid:false,child_derivation_valid:false};
  } catch {
    return {status:"DERIVATION_FAILED",matches:null,active_wallet_count:null,root_derivation_valid:false,child_derivation_valid:false};
  }

  // Dry-run the same first child path used for deposit-address issuance.
  // Never return or log the derived address/private key and never store or broadcast it.
  let childDerivationValid=false;
  try {
    const child=TronWeb.fromMnemonic(normalizedMnemonic,"m/44'/195'/0'/0/1",normalizedPassphrase);
    const childAddress=String(child.address||"");
    const childPrivateKey=String(child.privateKey||"").replace(/^0x/i,"");
    childDerivationValid=/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(childAddress)
      &&/^[a-fA-F0-9]{64}$/.test(childPrivateKey)
      &&TronWeb.address.fromPrivateKey(childPrivateKey)===childAddress;
  } catch {
    childDerivationValid=false;
  }
  if(!childDerivationValid)return {status:"DERIVATION_FAILED",matches:null,active_wallet_count:null,root_derivation_valid:true,child_derivation_valid:false};

  try {
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(rootAddress));
    const rootFingerprint=Array.from(new Uint8Array(digest)).map((byte)=>byte.toString(16).padStart(2,"0")).join("");
    const {data,error}=await admin.from("deposit_wallets").select("wallet_root_fingerprint").eq("network",network).eq("status","ACTIVE").limit(1000);
    if(error)return {status:"DATABASE_CHECK_FAILED",matches:null,active_wallet_count:null,root_derivation_valid:true,child_derivation_valid:true};
    const rows=Array.isArray(data)?data:[];
    if(rows.length===0)return {status:"NO_ACTIVE_WALLETS",matches:null,active_wallet_count:0,root_derivation_valid:true,child_derivation_valid:true};
    if(rows.length===1000)return {status:"CHECK_LIMIT_REACHED",matches:null,active_wallet_count:rows.length,root_derivation_valid:true,child_derivation_valid:true};
    if(rows.some((row:any)=>!String(row.wallet_root_fingerprint||"").trim()))return {status:"FINGERPRINT_MISSING",matches:false,active_wallet_count:rows.length,root_derivation_valid:true,child_derivation_valid:true};
    const matches=rows.every((row:any)=>row.wallet_root_fingerprint===rootFingerprint);
    return {status:matches?"MATCH":"MISMATCH",matches,active_wallet_count:rows.length,root_derivation_valid:true,child_derivation_valid:true};
  } catch {
    return {status:"CHECK_FAILED",matches:null,active_wallet_count:null,root_derivation_valid:true,child_derivation_valid:true};
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
  const mainnetAliasValuesDiffer=Boolean(MAINNET_TREASURY_KEY_ALIAS&&MAINNET_PAYOUT_FALLBACK_KEY
   &&normalizedKey(MAINNET_TREASURY_KEY_ALIAS)!==normalizedKey(MAINNET_PAYOUT_FALLBACK_KEY));
  // The canonical Mainnet key is selected first. A different fallback is informational only
  // when the selected canonical key independently matches the configured treasury signer.
  const mainnetLegacyAliasIgnored=Boolean(mainnetAliasValuesDiffer&&MAINNET_TREASURY_KEY_ALIAS&&mainnetSignerCheck.matches);
  const mainnetAliasConflict=Boolean(mainnetAliasValuesDiffer&&!mainnetSignerCheck.matches);
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
const withdrawalPayoutSeedDistinct=Boolean(MAINNET_WITHDRAWAL_HD_MNEMONIC.trim())
    &&normalizedMnemonic(MAINNET_WITHDRAWAL_HD_MNEMONIC)!==normalizedMnemonic(MAINNET_HD_MNEMONIC)
    &&normalizedMnemonic(MAINNET_WITHDRAWAL_HD_MNEMONIC)!==normalizedMnemonic(SHASTA_HD_MNEMONIC);
   const withdrawalPayoutModeEnabled=String(MAINNET_WITHDRAWAL_PAYOUT_MODE||"").trim().toUpperCase()==="EPHEMERAL_HD";
   const [mainnetHdRootCheck,shastaHdRootCheck,withdrawalPayoutHdCheck]=await Promise.all([
    hdRootFingerprintStatus(admin,"TRON MAINNET",MAINNET_HD_MNEMONIC,MAINNET_HD_PASSPHRASE),
    hdRootFingerprintStatus(admin,"TRON TESTNET",SHASTA_HD_MNEMONIC,SHASTA_HD_PASSPHRASE),
    withdrawalPayoutSeedDistinct?withdrawalPayoutHdStatus(MAINNET_WITHDRAWAL_HD_MNEMONIC,MAINNET_WITHDRAWAL_HD_PASSPHRASE):Promise.resolve({rootDerivationValid:false,childDerivationValid:false,rootFingerprintConsistent:false})
   ]);
  // Diagnostics disclose only presence/status and selected alias names, never key values or derived addresses.
  const keyDiagnostics={
   mainnet_primary_alias_present:Boolean(MAINNET_TREASURY_KEY_ALIAS),
   mainnet_fallback_alias_present:Boolean(MAINNET_PAYOUT_FALLBACK_KEY),
   mainnet_selected_key_alias:mainnetKeySourceAlias,
   mainnet_alias_conflict:mainnetAliasConflict,
   mainnet_legacy_alias_present:Boolean(MAINNET_PAYOUT_FALLBACK_KEY),
   mainnet_legacy_alias_ignored:mainnetLegacyAliasIgnored,
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
   mainnet_hd_root_fingerprint_status:mainnetHdRootCheck.status,
   mainnet_hd_root_derivation_valid:mainnetHdRootCheck.root_derivation_valid,
   mainnet_hd_child_derivation_valid:mainnetHdRootCheck.child_derivation_valid,
   mainnet_hd_root_matches_active_wallets:mainnetHdRootCheck.matches,
   mainnet_hd_root_active_wallet_count:mainnetHdRootCheck.active_wallet_count,
   shasta_hd_root_fingerprint_status:shastaHdRootCheck.status,
   shasta_hd_root_derivation_valid:shastaHdRootCheck.root_derivation_valid,
   shasta_hd_child_derivation_valid:shastaHdRootCheck.child_derivation_valid,
   shasta_hd_root_matches_active_wallets:shastaHdRootCheck.matches,
   shasta_hd_root_active_wallet_count:shastaHdRootCheck.active_wallet_count,
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
    mainnet_withdrawal_payout_wallet_mode:String(MAINNET_WITHDRAWAL_PAYOUT_MODE||"DISABLED").trim().toUpperCase(),
    mainnet_withdrawal_payout_hd_mnemonic_present:Boolean(MAINNET_WITHDRAWAL_HD_MNEMONIC.trim()),
    mainnet_withdrawal_payout_hd_seed_distinct_from_deposit_and_shasta:withdrawalPayoutSeedDistinct,
    mainnet_withdrawal_payout_hd_root_derivation_valid:withdrawalPayoutHdCheck.rootDerivationValid,
    mainnet_withdrawal_payout_hd_child_derivation_valid:withdrawalPayoutHdCheck.childDerivationValid,
    mainnet_withdrawal_payout_hd_root_fingerprint_consistent:withdrawalPayoutHdCheck.rootFingerprintConsistent,
  };
  const payoutKeysSafelySeparated= !mainnetAliasConflict&&!shastaAliasConflict
   &&mainnetShastaSelectedKeysDistinct&&treasuryAddressesDistinct&&shastaRulesConfigOk
   &&mainnetSignerCheck.matches&&shastaSignerCheck.matches;
   const withdrawalPayoutWalletReady=withdrawalPayoutModeEnabled&&withdrawalPayoutSeedDistinct
    &&withdrawalPayoutHdCheck.rootDerivationValid&&withdrawalPayoutHdCheck.childDerivationValid&&withdrawalPayoutHdCheck.rootFingerprintConsistent;
   const networkSecretsSafelySeparated=payoutKeysSafelySeparated
    &&!mainnetHdMnemonicAliasConflict&&!shastaHdMnemonicAliasConflict
    &&!mainnetHdPassphraseAliasConflict&&!shastaHdPassphraseAliasConflict
    &&mainnetShastaHdMnemonicsDistinct&&withdrawalPayoutWalletReady;
  const environment=String(prod.environment||"PRE_PRODUCTION").toUpperCase();
  const liveDeposits=system.live_deposits===true, realPayouts=system.real_payouts===true, goLive=system.production_go_live_approved===true;
  const productionLiveDeposits=prod.live_deposits_enabled===true, productionRealPayouts=prod.real_payouts_enabled===true, productionGoLive=prod.go_live_approved===true;
  const payoutsLocked=prod.payouts_locked!==false, runtimeEnabled=runtimeRow?.value_json?.enabled===true;
  const configurationConsistent=liveDeposits===Boolean(prod.live_deposits_enabled)&&realPayouts===Boolean(prod.real_payouts_enabled)&&goLive===Boolean(prod.go_live_approved);
  const secrets={
   supabase_service_role:Boolean(SERVICE_KEY),trongrid_api:Boolean(TRONGRID_KEY),cron_secret:Boolean(CRON_SECRET),
   mainnet_payout_key:Boolean(MAINNET_PAYOUT_KEY),testnet_payout_key:Boolean(TESTNET_PAYOUT_KEY),
    mainnet_withdrawal_payout_hd_mnemonic:Boolean(MAINNET_WITHDRAWAL_HD_MNEMONIC.trim()),
    mainnet_withdrawal_payout_mode:withdrawalPayoutModeEnabled,
   ai_review_endpoint:Boolean(AI_ENDPOINT),ai_review_api_key:Boolean(AI_KEY),ai_review_model:Boolean(AI_MODEL),telegram_bot_token:Boolean(TELEGRAM_TOKEN),telegram_chat:Boolean(TELEGRAM_CHAT_ID),telegram_approvers:TELEGRAM_APPROVER_IDS.length>0
  };
   const unresolvedPayoutResult=await admin.from("withdrawal_requests").select("id,status,amount,net_amount,created_at,payout_started_at,payout_txid").in("status",["APPROVED","PROCESSING"]).is("payout_txid",null).order("created_at",{ascending:true}).limit(200);
   const unresolvedPayouts=unresolvedPayoutResult.data||[];
   const unresolvedPayoutsClear=!unresolvedPayoutResult.error&&unresolvedPayouts.length===0;
  const mainnetBaseConfigOk=system.mode==="MAINNET"&&network==="TRON MAINNET"&&/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(receiving)&&mainnetUsdtContractOk;
   // Separate current gate status from static prerequisites so an OFF/LOCKED environment can pass preflight.
   const mainnetPayoutEnablementReady=mainnetBaseConfigOk&&networkSecretsSafelySeparated&&withdrawalPayoutWalletReady&&secrets.trongrid_api&&secrets.mainnet_payout_key&&secrets.telegram_bot_token&&secrets.telegram_chat&&secrets.telegram_approvers&&runtimeEnabled&&unresolvedPayoutsClear;
   const mainnetPayoutGateOk=environment==="PRODUCTION"&&mainnetBaseConfigOk&&realPayouts&&productionRealPayouts&&goLive&&productionGoLive&&!payoutsLocked&&runtimeEnabled;
   const mainnetDepositEnablementReady=mainnetBaseConfigOk&&secrets.trongrid_api&&secrets.cron_secret&&runtimeEnabled&&mainnetPayoutEnablementReady;
   const mainnetMonitoringReady=mainnetBaseConfigOk&&liveDeposits&&productionLiveDeposits&&mainnetPayoutGateOk&&secrets.trongrid_api&&secrets.cron_secret&&mainnetPayoutEnablementReady;
   const mainnetPayoutOperational=mainnetPayoutGateOk&&networkSecretsSafelySeparated&&withdrawalPayoutWalletReady&&secrets.trongrid_api&&secrets.mainnet_payout_key&&secrets.telegram_bot_token&&secrets.telegram_chat&&secrets.telegram_approvers;

  
   if(action==="mainnet_wallet_preflight"){
     // Admin-only dry-run: only while live-money gates are intentionally closed.
     // It consumes a unique sequence index so that candidate is never later reused,
     // but never creates a deposit wallet row, returns an address/private key, or broadcasts.
     const gatesIntentionallyClosed=
       environment==="PRE_PRODUCTION"&&
       system.mode==="MAINNET"&&network==="TRON MAINNET"&&
       liveDeposits===false&&realPayouts===false&&goLive===false&&
       productionLiveDeposits===false&&productionRealPayouts===false&&productionGoLive===false&&
       payoutsLocked===true;
     const prerequisitesReady=
       mainnetBaseConfigOk&&mainnetUsdtContractOk&&
       mainnetSignerCheck.matches===true&&
       networkSecretsSafelySeparated===true&&
       mainnetPayoutEnablementReady===true&&
       mainnetDepositEnablementReady===true&&
       Boolean(MAINNET_HD_MNEMONIC.trim());
     const checks:any={
       gatesIntentionallyClosed,
       officialMainnetUsdtContract:mainnetUsdtContractOk,
       treasurySignerMatchesConfiguredAddress:mainnetSignerCheck.matches===true,
       networkSecretsSeparated:networkSecretsSafelySeparated===true,
       payoutAndMonitoringPrerequisitesReady:mainnetPayoutEnablementReady===true&&mainnetDepositEnablementReady===true,
       configuredMainnetHdMnemonicPresent:Boolean(MAINNET_HD_MNEMONIC.trim()),
       rootDerivationValid:false,
       childDerivationValid:false,
       rootFingerprintConsistent:false,
       derivedAddressMatchesPrivateKey:false,
       candidateAddressUnique:false,
       candidateIndexUnique:false,
       gatesStillClosedAfterCheck:false
     };
     if(!gatesIntentionallyClosed||!prerequisitesReady){
       return json({
         status:"BLOCKED",
         error:"The locked Mainnet HD preflight requires PRE_PRODUCTION, all live-money flags OFF, the payout lock closed, and the approved signer/monitoring prerequisites ready.",
         checks,
         candidateIndexConsumed:false,
         walletRowCreated:false,
         walletAddressReturned:false,
         fundsMoved:false
       },409);
     }

     const {data:nextIndexValue,error:indexError}=await admin.rpc("next_tron_deposit_address_index");
     const candidateIndex=Number(nextIndexValue);
     if(indexError||!Number.isSafeInteger(candidateIndex)||candidateIndex<1||candidateIndex>=2147483648){
       return json({
         status:"BLOCKED",
         error:"Could not safely reserve a unique HD derivation index for the preflight.",
         checks,
         candidateIndexConsumed:false,
         walletRowCreated:false,
         walletAddressReturned:false,
         fundsMoved:false
       },503);
     }

     const {data:indexRows,error:indexLookupError}=await admin.from("deposit_wallets")
       .select("id").eq("network","TRON MAINNET").eq("derivation_index",candidateIndex).limit(1);
     if(indexLookupError||((indexRows||[]).length>0)){
       return json({
         status:"BLOCKED",
         error:"The reserved HD index could not be confirmed unique for Mainnet; no wallet row was created.",
         checks,
         candidateIndexConsumed:true,
         walletRowCreated:false,
         walletAddressReturned:false,
         fundsMoved:false
       },409);
     }

     let rootIdentity:any=null, candidateIdentity:any=null;
     try{
       rootIdentity=await deriveTronHdIdentity(MAINNET_HD_MNEMONIC,MAINNET_HD_PASSPHRASE,0);
       candidateIdentity=await deriveTronHdIdentity(MAINNET_HD_MNEMONIC,MAINNET_HD_PASSPHRASE,candidateIndex);
       checks.rootDerivationValid=/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(rootIdentity.address||""));
       checks.childDerivationValid=/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(candidateIdentity.address||""))&&/^[a-fA-F0-9]{64}$/.test(String(candidateIdentity.privateKey||""));
       checks.rootFingerprintConsistent=Boolean(rootIdentity.rootFingerprint)&&rootIdentity.rootFingerprint===candidateIdentity.rootFingerprint;
       checks.derivedAddressMatchesPrivateKey=Boolean(candidateIdentity.address&&candidateIdentity.privateKey)&&TronWeb.address.fromPrivateKey(candidateIdentity.privateKey)===candidateIdentity.address;
       checks.candidateAddressUnique=candidateIdentity.address!==receiving;
       checks.candidateIndexUnique=true;
       const {data:addressRows,error:addressLookupError}=await admin.from("deposit_wallets")
         .select("id").eq("network","TRON MAINNET").eq("address",candidateIdentity.address).limit(1);
       checks.candidateAddressUnique=checks.candidateAddressUnique&&!addressLookupError&&((addressRows||[]).length===0);
     }catch{
       // Do not include derivation exceptions: they may contain implementation details.
       checks.childDerivationValid=false;
     }finally{
       // The derived key material is never logged, returned, persisted or used to sign.
       rootIdentity=null;
       candidateIdentity=null;
     }

     const [{data:finalSystemRow,error:finalSystemError},
       {data:finalDepositRow,error:finalDepositError},
       {data:finalProdRow,error:finalProdError}]=await Promise.all([
         admin.from("platform_settings").select("value_json").eq("key","system_mode").maybeSingle(),
         admin.from("platform_settings").select("value_json").eq("key","deposit_rules").maybeSingle(),
         admin.from("platform_settings").select("value_json").eq("key","production_config").maybeSingle()
       ]);
     const finalSystem=finalSystemRow?.value_json||{},finalDeposit=finalDepositRow?.value_json||{},finalProd=finalProdRow?.value_json||{};
     checks.gatesStillClosedAfterCheck=Boolean(!finalSystemError&&!finalDepositError&&!finalProdError
       &&String(finalProd.environment||"").toUpperCase()==="PRE_PRODUCTION"
       &&String(finalDeposit.network||"").toUpperCase()==="TRON MAINNET"
       &&String(finalDeposit.token_contract||"").trim()==="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
       &&String(finalSystem.mode||"").toUpperCase()==="MAINNET"
       &&finalSystem.live_deposits===false&&finalSystem.real_payouts===false&&finalSystem.production_go_live_approved===false
       &&finalProd.live_deposits_enabled===false&&finalProd.real_payouts_enabled===false&&finalProd.go_live_approved===false
       &&finalProd.payouts_locked===true);

     const passed=Object.values(checks).every((value)=>value===true);
     const auditDescription="Locked Mainnet HD preflight "+(passed?"PASS":"FAIL")+
       "; root/child derivation checked; candidate index consumed without wallet-row creation, address disclosure, or transaction broadcast.";
     const {error:auditError}=await admin.from("audit_events").insert({
       actor_user_id:profile.id,
       event_type:"MAINNET_HD_PREFLIGHT",
       description:auditDescription
     });
     if(auditError){
       return json({status:"AUDIT_FAILED",error:"Preflight result could not be recorded in the audit log.",checks,
         candidateIndexConsumed:true,walletRowCreated:false,walletAddressReturned:false,fundsMoved:false},503);
     }
     return json({
       status:passed?"PASS":"FAIL",
       checks,
       candidateIndexConsumed:true,
       walletRowCreated:false,
       walletAddressReturned:false,
       fundsMoved:false
     },200);
   }

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

    // This endpoint has already authenticated the bearer token and verified the
    // caller's active MASTER ADMIN profile. Use the service-role client only for
    // the RPC intentionally restricted to service_role; never relax the legacy
    // authenticated RPC grants to make this write path work.
    const {data:updated,error:updateError}=await admin.rpc("set_production_config_from_admin_edge",{
      p_actor_auth_user_id:authResult.user.id,
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
   return json({readiness,secrets,key_diagnostics:keyDiagnostics,payout_keys_safely_separated:payoutKeysSafelySeparated,network_secrets_safely_separated:networkSecretsSafelySeparated,mainnet_usdt_contract_ok:mainnetUsdtContractOk,mainnet_monitoring_ready:mainnetMonitoringReady,mainnet_deposit_enablement_ready:mainnetDepositEnablementReady,mainnet_payout_enablement_ready:mainnetPayoutEnablementReady,mainnet_payout_operational:mainnetPayoutOperational,mainnet_withdrawal_payout_wallet_ready:withdrawalPayoutWalletReady,mainnet_withdrawal_payout_wallet_mode:String(MAINNET_WITHDRAWAL_PAYOUT_MODE||"DISABLED").trim().toUpperCase(),mainnet_wallet_preflight_available:true,unresolved_payouts:unresolvedPayouts.map((x:any)=>({id:x.id,status:x.status,amount:x.amount,net_amount:x.net_amount,created_at:x.created_at,payout_started_at:x.payout_started_at})),unresolved_payouts_clear:unresolvedPayoutsClear,checked_at:new Date().toISOString()});
 }catch(error){return json({error:String((error as Error)?.message||error).slice(0,500)},500);}
});
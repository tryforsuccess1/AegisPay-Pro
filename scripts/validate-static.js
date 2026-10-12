const fs=require('node:fs');
const vm=require('node:vm');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const exists=p=>fs.existsSync(p);

const must=[
  'client.html','master-admin.html','admin-auth.js',
  'supabase-client.js','supabase-service.js','aegis-auth-redirect.js','app-update.js',
   'service-worker.js','manifest.webmanifest','_headers','aegispay-logo.svg','_redirects','package.json',
  'database/migrations/20261003_private_verification_storage_policies.sql','database/migrations/20261004_restore_baseline_demo_configuration.sql',
  'database/migrations/20261005_align_withdrawal_wallet_rpc_grants.sql',
  'database/migrations/20261005_retire_client_complete_task_rpc.sql',
  'database/migrations/20261008_complete_phase3_production_controls.sql',
  'database/migrations/20261008_phase3_production_gate_hardening.sql',
  'database/migrations/20261008_phase3_readiness_response_alignment.sql',
  'database/migrations/20261009_harden_shop_task_account_state.sql',
  'database/migrations/20261009_harden_shop_task_product_and_runtime.sql',
  'database/migrations/20261009_retire_public_username_email_lookup.sql',
  'database/migrations/20261010_fail_closed_shop_cycle_checkout_jwt_role.sql',
  'database/migrations/20261011_ai_support_cases.sql',
  'database/migrations/20261011_block_unreconciled_payout_go_live.sql',
  'database/migrations/20261011_withdrawal_ai_wallet_validation.sql',
  'database/migrations/20261011_reconcile_invalid_unbroadcast_withdrawal.sql',
  'database/migrations/20261011_validate_tron_wallet_base58check.sql',
  'database/migrations/20261011_fix_tron_address_validator_collation.sql',
  'database/migrations/20261011_fix_tron_address_validator_bytes.sql',
  'database/migrations/20261011_exact_integer_tron_address_decode.sql',
  'database/migrations/20261012_withdrawal_ledger_debit_reconciliation.sql',
  'supabase/functions/production-readiness/index.ts',
  'supabase/functions/submit-kyc/ai-review.ts','supabase/functions/submit-deposit/ai-review.ts',
  'site/index.html','site/site.css','android/app/build.gradle',
  'android/app/src/main/java/com/aegispay/app/MainActivity.java',
  '.github/workflows/ci.yml','.github/workflows/android-apk.yml',
  '.github/workflows/web-portal-deploy.yml','.github/workflows/website-apk-release.yml'
];
for(const p of must)assert(exists(p),'Missing canonical source file: '+p);

function assertInlineScriptsParse(file){
  const html=fs.readFileSync(file,'utf8');
  const re=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match,index=0;
  while((match=re.exec(html))){
    const attrs=match[1]||'',source=match[2]||'';
    if(/\bsrc\s*=/.test(attrs))continue;
    if(/\btype\s*=\s*["']?(?:application\/json|application\/ld\+json|text\/template|importmap)/i.test(attrs))continue;
    index++;
    try{new vm.Script(source,{filename:file+' inline script '+index});}
    catch(error){throw new Error(file+' inline script '+index+' has a syntax error: '+error.message);}
  }
  assert(index>0,file+' has no inline scripts to validate');
}
assertInlineScriptsParse('client.html');
assertInlineScriptsParse('master-admin.html');

const client=fs.readFileSync('client.html','utf8');
assert(client.includes('bootLive'),'Client inline runtime bootstrap is missing');
assert(client.includes('./supabase-sdk.js'),'Client must load the pinned local Supabase SDK');
const androidBuild=fs.readFileSync('android/app/build.gradle','utf8');
assert(androidBuild.includes("include 'supabase-sdk.js'"),'Client Android assets must include the pinned Supabase SDK');
assert(androidBuild.includes("'Activate Selected Tier'"),'Android build guard must match the current tier UI');
assert(client.includes('liveHome'),'Client Home runtime is missing');
assert(client.includes('liveTopup'),'Client Top Up runtime is missing');
assert(client.includes('liveWithdraw'),'Client Withdrawal runtime is missing');
assert(client.includes('Username or Email'),'Canonical client login must accept username or email');
assert(client.includes("db.functions.invoke('username-login'"),'Username login must use the protected Edge Function');
assert(!client.includes('resolve_login_email'),'Client must not call the public username-to-email RPC');
assert(client.includes('public-signup'),'Canonical client signup function is not wired');
assert(client.includes('resetPasswordForEmail'),'Client password reset request is not wired');
assert(client.includes("reset=1"),'Client password reset redirect marker is missing');
assert(client.includes('exchangeCodeForSession'),'PKCE password reset handling is missing');
assert(client.includes("setSession({access_token:accessToken,refresh_token:refreshToken})"),'Implicit password recovery token handling is missing');
assert(client.includes("https://aegispay-web.aegispay.workers.dev/?reset=1"),'Password reset must target the canonical Worker');
assert(client.includes("db.rpc('link_withdrawal_wallet',{p_address:wallet,p_owner_name:profile.name})"),'Client wallet-link flow must use the owner-name protected RPC');
assert(client.includes("complete-cycle-checkout"),'Client Shop checkout endpoint is not wired');
assert(client.includes("db.rpc('complete_shop_task',{p_task_id:taskId})"),'Client per-task Shop completion RPC is missing');
assert(client.includes("db.rpc('record_shop_task_purchase'"),'Client Shop purchase confirmation RPC is not wired');
const shopHardening=fs.readFileSync('database/migrations/20261009_harden_shop_task_account_state.sql','utf8');
assert(shopHardening.includes("v_profile.frozen_until > now()"),'Shop task RPCs must enforce security freeze state');
assert(shopHardening.includes("NOT public.app_runtime_enabled()"),'Shop task RPCs must enforce the global runtime pause');
assert((shopHardening.match(/v_profile.role <> 'USER'/g)||[]).length===2,'Both Shop mutation RPCs must validate client role');
assert((shopHardening.match(/status.*NOT IN \('ACTIVE','NORMAL'\)/g)||[]).length===2,'Both Shop mutation RPCs must validate active account status');
const shopProductHardening=fs.readFileSync('database/migrations/20261009_harden_shop_task_product_and_runtime.sql','utf8');
assert(shopProductHardening.includes("The assigned Shop task does not have a resolvable product"),'Shop purchase confirmation must fail closed when its assigned product cannot be resolved');
assert(shopProductHardening.includes("NOT public.app_runtime_enabled()"),'Cycle checkout must honor the global runtime pause');
const shopCheckoutRoleHardening=fs.readFileSync('database/migrations/20261010_fail_closed_shop_cycle_checkout_jwt_role.sql','utf8');
assert(shopCheckoutRoleHardening.includes("auth.jwt() ->> 'role'"),'Shop checkout must support current Supabase JWT claim settings');
assert(shopCheckoutRoleHardening.includes("v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated','service_role')"),'Shop checkout must reject missing and unsupported JWT roles');
assert(client.includes("qs.get('shop_purchase')==='confirmed'"),'Client Shop purchase return callback is missing');
assert(client.includes("&product=")||client.includes("'&product='"),'Shop task marketplace link must carry the assigned product ID');
assert(client.includes("qs.get('reset')==='1'"),'Client password reset route is missing');
assert(!client.includes("db.rpc('link_withdrawal_wallet',{p_wallet:wallet})"),'Legacy one-argument wallet RPC must not be called by the client');
assert(!client.includes('aegispay-client1.netlify.app')&&!client.includes('aegispay-ali-archive.netlify.app'),'Legacy Netlify production redirect remains in client source');
assert(client.includes('Secure &amp; Verified'),'Client security footer is missing');
assert(client.includes('© 2023–2026 AegisPay'),'Client year marker is missing');
assert(client.length>20000,'Canonical client source unexpectedly shrank; review before release');
assert(!client.includes('aegis-core.js')&&!client.includes('app.js'),'Legacy demo scripts are still wired to client');

const admin=fs.readFileSync('master-admin.html','utf8');
assert(admin.includes('./admin-auth.js')&&!admin.includes('aegis-core.js')&&!admin.includes('app.js'),'Admin entry wiring incomplete');

const adminAuth=fs.readFileSync('admin-auth.js','utf8');
const productionReadinessFunction=fs.readFileSync('supabase/functions/production-readiness/index.ts','utf8');
assert(adminAuth.includes('Production Readiness')&&adminAuth.includes('aaProductionForm')&&adminAuth.includes("invokeFunction('production-readiness'")&&adminAuth.includes('get_production_readiness'),'Phase 3 Master Admin readiness controls are missing');
assert(productionReadinessFunction.includes('rpc("set_production_config"'),'Phase 3 production settings must be saved through the protected readiness function');
assert(productionReadinessFunction.includes('mainnet_payout_enablement_ready')&&productionReadinessFunction.includes('UNRECONCILED_APPROVED_PAYOUTS'),'Production payout activation must have secret readiness and unresolved-withdrawal guards');
assert(adminAuth.includes('Unreconciled Payouts')&&adminAuth.includes('REAL USDT MAINNET PAYOUT')&&adminAuth.includes('ai-support'),'Master Admin must show payout reconciliation blockers, confirm real payouts and support AI cases');
const goLiveGuard=fs.readFileSync('database/migrations/20261011_block_unreconciled_payout_go_live.sql','utf8');
assert(goLiveGuard.includes("status IN ('APPROVED','PROCESSING') AND payout_txid IS NULL"),'Database go-live guard must block unreconciled approved/processing payouts');
const tronValidator=fs.readFileSync('database/migrations/20261011_exact_integer_tron_address_decode.sql','utf8');
const walletRpc=fs.readFileSync('database/migrations/20261011_validate_tron_wallet_base58check.sql','utf8');
const walletOps=fs.readFileSync('supabase/functions/admin-account-ops/index.ts','utf8');
const adminQueuesSource=fs.readFileSync('supabase/functions/admin-queues/index.ts','utf8');
const payoutSource=fs.readFileSync('supabase/functions/execute-payout/index.ts','utf8');
assert(/v_number\s*:=\s*div\(v_number,256\)/.test(tronValidator)&&tronValidator.includes("extensions.digest(extensions.digest"),'TRON wallet validator must use exact integer Base58 decoding and a double-SHA256 checksum');
assert(walletRpc.includes('public.is_valid_tron_address(v_wallet)')&&walletRpc.includes('destination_address=v_address'),'Wallet link and withdrawal request must reject case-corrupted addresses');
assert(walletOps.includes('is_valid_tron_address')&&!walletOps.includes('.trim().toUpperCase()'),'Master Admin wallet changes must preserve case and validate Base58Check');
const walletAiGuard=fs.readFileSync('database/migrations/20261011_withdrawal_ai_wallet_validation.sql','utf8');
assert(walletAiGuard.includes('WITHDRAWAL_WALLET_INVALID_CASE_OR_CHECKSUM'),'Withdrawal AI must send invalid-case wallets to manual review');
assert(!client.includes('withdrawWallet.value.trim().toUpperCase()'),'Client wallet linking must preserve original TRON Base58 case');
assert(payoutSource.includes('INVALID_WITHDRAWAL_DESTINATION')&&payoutSource.includes('is_valid_tron_address'),'Payout source must reject invalid exact-case recipient addresses');
assert((payoutSource.match(/is_valid_tron_address/g)||[]).length===1,'Payout source must contain one exact-case recipient validation guard, not duplicate copies');
const destinationGuard=payoutSource.indexOf('const { data: destinationValid');
assert(destinationGuard>=0&&destinationGuard<payoutSource.indexOf('// Atomic claim: only one invocation can transition an approved request to PROCESSING'),'Payout recipient must be validated before the atomic payout claim');
const depositMonitorSource=fs.readFileSync('supabase/functions/monitor-deposits/index.ts','utf8');
assert(depositMonitorSource.includes('verify_deposit_monitor_cron_secret')&&depositMonitorSource.includes('x-aegis-cron-secret'),'Deposit monitor must validate the configured Vault-backed cron secret');
assert(depositMonitorSource.includes('.in("ai_review_status", ["APPROVED","MANUAL_APPROVED"])'),'Automatic deposit monitor may process only AI-approved/manual-approved submissions');
assert(adminQueuesSource.includes('is_valid_tron_address')&&adminQueuesSource.includes('walletValid'),'Master Admin withdrawal queue must show exact-case recipient validation');
assert(adminAuth.includes('DO NOT EXECUTE THIS PAYOUT')&&adminAuth.includes('Changing the profile wallet does not automatically change this existing request'),'Invalid recipients must be visibly blocked in the Master Admin queue');
const invalidWalletRefund=fs.readFileSync('database/migrations/20261011_reconcile_invalid_unbroadcast_withdrawal.sql','utf8');
const accountOps=fs.readFileSync('supabase/functions/admin-account-ops/index.ts','utf8');
assert(invalidWalletRefund.includes('payout_txid IS NULL')&&invalidWalletRefund.includes('payout_started_at IS NULL')&&invalidWalletRefund.includes('balance_deducted=true')&&invalidWalletRefund.includes('WITHDRAWAL_REFUND'),'Invalid-wallet refund must only run for provably unbroadcast deducted withdrawals and write a ledger entry');
assert(accountOps.includes('cancel_invalid_withdrawal_refund')&&adminAuth.includes('invalid-withdrawal-refund')&&adminAuth.includes('This will mark the approved request FAILED'),'Master Admin must have an explicitly confirmed invalid-wallet reconciliation workflow');

const payout=fs.readFileSync('supabase/functions/execute-payout/index.ts','utf8');
assert(payout.includes('production_config')&&payout.includes('Production payout gate is locked'),'Phase 3 payout gate is missing');

const service=fs.readFileSync('supabase-service.js','utf8');
assert(service.includes("'username-login'"),'Shared auth helper must use protected username login');
assert(!service.includes("c.rpc('resolve_login_email'"),'Shared auth helper must not expose username-to-email lookup');
for(const m of [
  'claim_aegispay_profile','public-signup','signInWithPassword','resetPasswordForEmail',
  'request_withdrawal','app_runtime_enabled','set_app_runtime_enabled'
])assert(service.includes(m),'Supabase marker missing: '+m);
assert(service.includes('https://aegispay-web.aegispay.workers.dev/?reset=1'),'Shared password reset redirect must target the canonical Worker');

const gradle=fs.readFileSync('android/app/build.gradle','utf8');
assert(gradle.includes("include 'client.html'")&&!gradle.includes("include 'client-fresh.html'")&&gradle.includes("include 'master-admin.html'"),'Android canonical entries missing');
assert(gradle.includes("include 'app-update.js'"),'Android Client build must bundle the updater helper');
assert(client.includes('window.AEGIS_ANDROID_APP=!!window.AegisNative;'),'Canonical Client must identify the native Android runtime');
assert(client.includes('<script src="./app-update.js"></script>'),'Canonical Client must load the remote update checker');
assert(gradle.includes('ensureSupabaseSdk'),'Build must provision the pinned Supabase SDK for web packaging');
assert(!gradle.includes("include 'styles.css'")&&!gradle.includes("include 'premium.css'"),'Retired CSS assets must not be bundled into the Android admin build');
assert(!gradle.includes("include 'client-auth.js'")&&!gradle.includes("include 'client-home.css'"),'Retired client runtime assets must not be bundled into Android client builds');
assert(!gradle.includes('syncBlueprintRuntime')&&!gradle.includes('aegis-core.js')&&!gradle.includes('app.js'),'Legacy Android runtime remains wired');

const native=fs.readFileSync('android/app/src/main/java/com/aegispay/app/MainActivity.java','utf8');
assert(!native.includes('aegispay-pro-web.aegispay.workers.dev')&&!native.includes('aegispay-client.netlify.app')&&!native.includes('__UNI__D835ED9'),'Android stale remote/legacy identity remains');
assert(native.includes('aegispay-pro.pages.dev')&&native.includes('UPDATE_HOST'),'Android update endpoint must remain explicitly allowlisted for Cloudflare Pages');

const androidWorkflow=fs.readFileSync('.github/workflows/android-apk.yml','utf8');
for(const marker of [
  ':app:assembleClientDebug',':app:assembleAdminDebug',':app:bundleClientDebug',':app:bundleAdminDebug',
  ':app:assembleClientRelease',':app:assembleAdminRelease',':app:bundleClientRelease',':app:bundleAdminRelease'
])assert(androidWorkflow.includes(marker),'Android Phase 5 build workflow missing: '+marker);
assert(androidWorkflow.includes('outputs/bundle/clientDebug/app-client-debug.aab'),'Android client debug AAB verification is missing');
assert(androidWorkflow.includes('outputs/bundle/adminDebug/app-admin-debug.aab'),'Android admin debug AAB verification is missing');
assert(androidWorkflow.includes('outputs/bundle/clientRelease/app-client-release.aab'),'Android client release AAB verification is missing');
assert(androidWorkflow.includes('outputs/bundle/adminRelease/app-admin-release.aab'),'Android admin release AAB verification is missing');

const deploy=fs.readFileSync('.github/workflows/web-portal-deploy.yml','utf8');
assert(deploy.includes('cp client.html site/app/index.html'),'Deploy source of truth is not client.html');
assert(deploy.includes('cp master-admin.html site/master-admin.html'),'Admin deploy source is not master-admin.html');
assert(deploy.includes('test -s site/downloads/aegispay-admin.apk')&&deploy.includes('VERSIONED_ADMIN'),'Web deploy must package and verify the Master Admin APK');
assert(deploy.includes('adminApkUrl')&&deploy.includes('adminSha256')&&deploy.includes('hashlib.sha256'),'Update manifest must validate both APK download URLs and SHA-256 digests');
assert(deploy.includes('rm -rf site/app site/downloads'),'Generated deploy directories are rebuilt cleanly');
assert(!deploy.includes('netlify-cli deploy'),'Legacy Netlify production deployment must stay disabled during Cloudflare migration');

const rel=fs.readFileSync('.github/workflows/website-apk-release.yml','utf8');
assert(rel.includes(':app:assembleClientDebug'),'Aurora APK release workflow must build the canonical client flavor');
assert(rel.includes(':app:bundleClientDebug'),'Aurora APK release workflow must build the canonical client AAB');
assert(rel.includes(':app:assembleAdminDebug')&&rel.includes(':app:bundleAdminDebug'),'Aurora APK release workflow must build the Master Admin APK and AAB');
assert(rel.includes('VERSION_CODE=$(sed'),'Aurora release workflow must derive the Android version code from build.gradle');
assert(rel.includes('VERSION_NAME=$(sed'),'Aurora release workflow must derive the Android version name from build.gradle');
assert(!rel.includes('aurora-apk-2.5.9-b38'),'Aurora release workflow must not pin the obsolete Build 38 release tag');
assert(rel.includes('outputs/bundle/clientDebug/app-client-debug.aab'),'Aurora AAB output verification is missing');
assert(rel.includes('outputs/apk/admin/debug/app-admin-debug.apk')&&rel.includes('outputs/bundle/adminDebug/app-admin-debug.aab'),'Master Admin APK and AAB outputs must be verified before release');
assert(!rel.includes('netlify-cli deploy'),'Release workflow still has active Netlify production deployment');

const updater=fs.readFileSync('app-update.js','utf8');
assert(updater.includes('/app-version.json'),'Updater web manifest endpoint missing');
assert(updater.includes("https://aegispay-pro.pages.dev/app-version.json"),'Android updater must check the remote version manifest');
assert(!updater.includes("!nativeReady()||isAdmin()||!remote"),'Master Admin Android updater must not be unconditionally disabled');
assert(updater.includes('m.adminApkUrl')&&updater.includes('m.adminSha256'),'Android updater must support the Master Admin APK and SHA-256 manifest fields');
const gradleSource=fs.readFileSync('android/app/build.gradle','utf8');
assert(gradleSource.includes("include 'app-version.json'"),'Android client build must bundle app-version.json');
assert(fs.readFileSync('_redirects','utf8').includes('/app /app/ 301')&&fs.readFileSync('_redirects','utf8').includes('/app/ /app/home.html 200'),'Canonical app redirect missing');

const functions=[
  'admin-queues','admin-review','admin-account-ops','ai-support','execute-payout','monitor-deposits','production-readiness','complete-cycle-checkout','complete-password-reset',
  'public-signup','submit-deposit','submit-kyc','telegram-withdrawal','verify-deposit','username-login','withdrawal-ai-review','record-user-access'
];
for(const f of functions)assert(exists('supabase/functions/'+f+'/index.ts'),'Missing Edge Function source: '+f);

const stale=['index.html','app.js','aegis-core.js','backend','preview','apk-artifact','database/schema.sql','scripts/smoke-api.js','scripts/test-core-auth.js','assets/apps'];
for(const p of stale)assert(!exists(p),'Legacy path remains in canonical main: '+p);
for(const p of [
  '20261011_exact_integer_tron_address_decode.sql',
  '20261011_fix_tron_address_validator_bytes.sql',
  '20261011_fix_tron_address_validator_collation.sql'
])assert(!exists(p),'Obsolete duplicate root-level SQL file must not be used instead of database/migrations: '+p);

const withdrawalLedgerFix=fs.readFileSync('database/migrations/20261012_withdrawal_ledger_debit_reconciliation.sql','utf8');
assert(withdrawalLedgerFix.includes("'WITHDRAWAL_DEBIT'"),'Approved withdrawals must write a debit ledger entry');
assert(withdrawalLedgerFix.includes("'WITHDRAWAL_REFUND'"),'Historical debit backfill must be linked to a refund record');
assert(withdrawalLedgerFix.includes("'WITHDRAWAL_INVALID_WALLET_REFUNDED'"),'Historical debit backfill must require the audited invalid-wallet refund event');
assert(withdrawalLedgerFix.includes("IF NOT p_approve THEN")&&withdrawalLedgerFix.includes("current_platform_balance = COALESCE(current_platform_balance, 0) - w.amount"),'Withdrawal approval must deduct only after balance/reservation validation');
assert(withdrawalLedgerFix.includes("A withdrawal debit already exists for this request")&&withdrawalLedgerFix.includes("IS DISTINCT FROM 'PENDING'"),'Withdrawal approval must reject duplicate debit references and null decisions safely');
assert(withdrawalLedgerFix.includes("reference_id = p_request_id::text"),'Withdrawal ledger entries must carry the withdrawal reference');
assert(withdrawalLedgerFix.includes("Conflicting WITHDRAWAL_DEBIT reference already exists; manual reconciliation required"),'Backfill must fail closed when a debit reference has a conflicting owner or amount');
assert(withdrawalLedgerFix.includes("Duplicate WITHDRAWAL_DEBIT references already exist; manual reconciliation required"),'Backfill must fail closed when duplicate debit references already exist');
assert(withdrawalLedgerFix.includes("AND NOT EXISTS (\n    SELECT 1\n    FROM public.account_ledger AS debit\n    WHERE debit.entry_type = 'WITHDRAWAL_DEBIT'\n      AND debit.reference_id = w.id::text\n  );"),'Backfill idempotency guard must match debit references independent of amount and owner');
const withdrawalBackfillInsert = withdrawalLedgerFix.indexOf('INSERT INTO public.account_ledger (');
const withdrawalPreflight = withdrawalLedgerFix.indexOf('DO $');
const withdrawalBackfillGuard = withdrawalLedgerFix.indexOf('AND NOT EXISTS (', withdrawalBackfillInsert);
const withdrawalFinalize = withdrawalLedgerFix.indexOf('CREATE OR REPLACE FUNCTION public.finalize_withdrawal');
assert(withdrawalPreflight > withdrawalLedgerFix.indexOf('BEGIN;') && withdrawalPreflight < withdrawalBackfillInsert,'Conflicting-reference preflight must be a valid DO block before the backfill INSERT');
assert(withdrawalBackfillGuard > withdrawalBackfillInsert && withdrawalBackfillGuard < withdrawalFinalize,'Backfill NOT EXISTS guard must remain inside the INSERT SELECT WHERE clause');
assert(withdrawalLedgerFix.includes('END;\\n$;\\n\\nINSERT INTO public.account_ledger ('),'Migration preflight dollar-quoting and statement boundary must be valid');
assert(withdrawalFinalize > withdrawalBackfillGuard && withdrawalLedgerFix.includes('COMMIT;'),'Withdrawal migration must remain ordered and transaction-bounded');

console.log('AegisPay canonical architecture validation: PASS');
assert(!fs.existsSync('netlify.toml'),'Obsolete Netlify production configuration must not return to canonical main');

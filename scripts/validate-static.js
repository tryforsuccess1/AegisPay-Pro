const fs=require('node:fs');
const vm=require('node:vm');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const exists=p=>fs.existsSync(p);

const must=[
  'client.html','master-admin.html','admin-auth.js','scripts/client-browser-smoke.cjs',
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
  'database/migrations/20261013_harden_withdrawal_dual_approval_ledger.sql',
  'database/migrations/20261013_harden_security_definer_search_paths.sql',
  'database/migrations/20261013_gate_mainnet_deposits_on_payout_readiness.sql',
  'database/migrations/20261013_fix_deposit_enablement_gate_and_txid_uniqueness.sql',
  'database/migrations/20261014_phase1_validate_withdrawal_wallets.sql',
  'database/migrations/20261014120000_revoke_trigger_only_function_execute.sql',
  'database/migrations/20261014150000_google_oauth_profile_linking.sql',
  'scripts/sql-tests/deposit_migration_fixture.sql',
  'scripts/sql-tests/deposit_migration_assertions.sql',
  '.github/workflows/sql-migration-tests.yml',
  'docs/recovered-sql/ensure_auto_task_cycle_live_reference_20261013.sql',
  'scripts/sql-tests/withdrawal_migration_fixture.sql',
  'scripts/sql-tests/withdrawal_migration_assertions.sql',
  'supabase/functions/production-readiness/index.ts',
  'supabase/functions/_shared/pwned-passwords.ts','supabase/functions/_shared/pwned-passwords_test.ts',
  'supabase/functions/submit-kyc/ai-review.ts','supabase/functions/submit-deposit/ai-review.ts',
  'site/index.html','site/site.css','android/app/build.gradle',
  'android/app/src/main/java/com/aegispay/app/MainActivity.java',
  '.github/workflows/ci.yml','.github/workflows/android-apk.yml',
  '.github/workflows/web-portal-deploy.yml','.github/workflows/website-apk-release.yml','.github/workflows/withdrawal-migration-tests.yml'
];
for(const p of must)assert(exists(p),'Missing canonical source file: '+p);

const weightedTaskReference=fs.readFileSync('docs/recovered-sql/ensure_auto_task_cycle_live_reference_20261013.sql','utf8');
assert(weightedTaskReference.includes('REFERENCE SNAPSHOT ONLY')&&weightedTaskReference.includes('NOT THE ORIGINAL MIGRATION SOURCE'),'Recovered weighted Shop function must remain explicitly marked as reference-only');
assert(weightedTaskReference.includes('so.task_weight')&&weightedTaskReference.includes('weight_sum'),'Recovered weighted Shop function must preserve product-weighted allocation logic');

const triggerOnlyGrantMigration=fs.readFileSync('database/migrations/20261014120000_revoke_trigger_only_function_execute.sql','utf8');
assert(triggerOnlyGrantMigration.includes('REVOKE ALL ON FUNCTION public.enforce_valid_tron_withdrawal_address()'),'Trigger-only wallet validator must not remain callable as an RPC');
assert(/FROM PUBLIC, anon, authenticated\s*;/i.test(triggerOnlyGrantMigration),'Trigger-only wallet validator must revoke public and authenticated client execution');
assert(!/^\s*FROM\b[^\n]*service_role/im.test(triggerOnlyGrantMigration),'Keep service_role maintenance permission for controlled trigger maintenance');
const googleOAuthMigration=fs.readFileSync('database/migrations/20261014150000_google_oauth_profile_linking.sql','utf8');
assert(googleOAuthMigration.includes("NEW.raw_app_meta_data ->> 'provider', '')) = 'google'")&&googleOAuthMigration.includes('NEW.email_confirmed_at IS NOT NULL'),'Google OAuth profile changes must only apply to Google identities with verified email');
assert(googleOAuthMigration.includes('auth_user_id = NEW.id')&&googleOAuthMigration.includes('auth_user_id IS NULL')&&googleOAuthMigration.includes("upper(status) <> 'DELETED'")&&googleOAuthMigration.includes("role = 'USER'"),'Google OAuth must only claim matching unlinked non-deleted profiles');
assert(googleOAuthMigration.includes('v_username_base')&&googleOAuthMigration.includes('v_username_suffix')&&googleOAuthMigration.includes('regexp_replace'),'New Google OAuth signups must receive a unique generated Client ID when metadata has no username');

const securityHeaders=fs.readFileSync('_headers','utf8').toLowerCase();
for(const header of [
  'x-content-type-options: nosniff',
  'referrer-policy: strict-origin-when-cross-origin',
  'x-frame-options: deny',
  'permissions-policy: camera=(), microphone=(), geolocation=()',
  'strict-transport-security: max-age=31536000'
])assert(securityHeaders.includes(header),'Missing browser security header: '+header);


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
const masterAdmin=fs.readFileSync('master-admin.html','utf8');
assert(masterAdmin.includes('Interaction and accessibility polish: admin controls use consistent touch targets'),'Master Admin touch target styles are missing');
assert(masterAdmin.includes('button{min-height:40px}'),'Master Admin controls must have a consistent minimum height');
assert(masterAdmin.includes('button:focus-visible,a:focus-visible'),'Master Admin keyboard focus indicators are missing');
assert(masterAdmin.includes('@media(max-width:360px)'),'Master Admin needs a narrow-screen layout adjustment');
assert(masterAdmin.includes('id="aegis-audit-contrast"'),'Master Admin primary-action contrast overrides are missing');
assert(masterAdmin.includes('linear-gradient(135deg,#c94932,#b83b7d)!important'),'Master Admin primary action gradient must pass white-text contrast');
assert(masterAdmin.includes('.aa-icon-button{width:40px;height:40px;min-width:40px;min-height:40px}'),'Master Admin icon controls must remain square and aligned');
const withdrawalMigration=fs.readFileSync('database/migrations/20261014_phase1_validate_withdrawal_wallets.sql','utf8');
assert(withdrawalMigration.includes('COALESCE(public.is_valid_tron_address(NEW.destination_address), false) IS NOT TRUE'),'Database writes must fail closed on invalid or NULL TRON addresses');
assert(withdrawalMigration.includes('users_validate_withdrawal_destination'),'Saved user wallets must be validated server-side');
assert(withdrawalMigration.includes('BEFORE INSERT OR UPDATE OF destination_address ON public.users'),'Saved-wallet validation must cover inserts and address changes');
assert(withdrawalMigration.includes('BEFORE INSERT OR UPDATE OF destination_address ON public.withdrawal_requests'),'Withdrawal destination validation must cover inserts and address changes');
assert(withdrawalMigration.includes("TG_TABLE_NAME = 'users'")&&withdrawalMigration.includes("COALESCE(trim(NEW.destination_address), '') = ''"),'A blank saved user wallet must remain allowed until a user sets one');
assert(withdrawalMigration.includes("SET search_path TO ''"),'Trigger function must use a locked-down search_path');
assert(client.includes('bootLive'),'Client inline runtime bootstrap is missing');
assert(client.includes("const botEntry=target.closest(")&&client.includes('[data-go="bot"]')&&client.includes('[data-a="sup"]'),'AI Assistant and Support taps must route through the central mobile-safe handler');
assert(client.includes(".notif-card[data-notification-id],.nt-i[data-notification-id]"),'Both notification-card renderers must open their selected notification details');
assert(client.includes("openAegisSupport();return;")&&client.includes("return await openAegisSupport();"),'AI Assistant and Support must use the guarded direct navigation handler');
assert(client.includes('async function openAegisSupport()')&&client.includes("root.innerHTML=SC.bot();")&&client.includes('data-support-error')&&client.includes('data-support-retry')&&client.includes('data-support-home'),'AI Assistant must render directly and expose actionable diagnostics if rendering fails');
assert(client.includes('id="aiOnline"')&&client.includes('Sign-in required')&&client.includes('Support temporarily unavailable'),'AI failures must display visible status and session/network guidance');
assert(client.includes("window.__aegisOpenNotificationById(notification.getAttribute('data-notification-id'))"),'Notification taps must open the selected notification by ID');

const requiredClientInvokes=['ai-support','complete-cycle-checkout','complete-password-reset','execute-payout','public-signup','record-user-access','submit-deposit','submit-kyc','telegram-withdrawal','username-login','withdrawal-ai-review'];
assert(client.includes('id="aiMessages"')&&client.includes('id="aiInput"')&&client.includes('id="aiSend"'),'AI Assistant must render its message panel, input, and send control');
assert(client.includes("db.functions.invoke('ai-support',{body:{message,history:previous}})"),'AI Assistant must submit its message and conversation history to ai-support');
assert(client.includes("button.onclick=()=>aiAsk(input?.value||'')"),'AI send button must invoke the AI request handler');
assert(client.includes("if(e.key==='Enter'&&!e.shiftKey)"),'AI input must support Enter-to-send without swallowing Shift+Enter');
assert(client.includes("document.addEventListener('click',function(e){const q=e.target.closest('[data-q]')"),'AI quick prompts must invoke the AI request handler');
const pwnedPasswordHelper=fs.readFileSync('supabase/functions/_shared/pwned-passwords.ts','utf8');
const publicSignupSource=fs.readFileSync('supabase/functions/public-signup/index.ts','utf8');
const passwordResetSource=fs.readFileSync('supabase/functions/complete-password-reset/index.ts','utf8');
const pwnedPasswordTests=fs.readFileSync('supabase/functions/_shared/pwned-passwords_test.ts','utf8');
assert(pwnedPasswordHelper.includes('crypto.subtle.digest("SHA-1"')&&pwnedPasswordHelper.includes('https://api.pwnedpasswords.com/range/')&&pwnedPasswordHelper.includes('fullHash.slice(0, 5)'),'Password screening must query the HIBP range API using only a five-character SHA-1 prefix');
assert(pwnedPasswordHelper.includes('"Add-Padding": "true"')&&pwnedPasswordHelper.includes('PasswordSecurityUnavailableError'),'Password screening must request privacy padding and fail closed if the provider is unavailable');
assert(publicSignupSource.includes('assertPasswordNotPwned(password)')&&publicSignupSource.includes('COMPROMISED_PASSWORD')&&publicSignupSource.includes('PASSWORD_SECURITY_UNAVAILABLE'),'Signup must reject compromised passwords before creating an Auth user');
assert(passwordResetSource.includes('assertPasswordNotPwned(password)')&&passwordResetSource.includes('COMPROMISED_PASSWORD')&&passwordResetSource.includes('PASSWORD_SECURITY_UNAVAILABLE'),'Password reset must reject compromised passwords before changing the Auth password');
const pwnedPasswordTestsLower=pwnedPasswordTests.toLowerCase();
assert(pwnedPasswordTestsLower.includes('breached passwords are rejected')&&pwnedPasswordTestsLower.includes('only the first five hash characters')&&pwnedPasswordTestsLower.includes('fails closed'),'Password screening regression tests must cover breached, clean and unavailable cases');
const aiSupportSource=fs.readFileSync('supabase/functions/ai-support/index.ts','utf8');
assert(aiSupportSource.includes('AI_ASSISTANT_ENDPOINT')&&aiSupportSource.includes('AI_ASSISTANT_API_KEY')&&aiSupportSource.includes('completionUrl'),'AI support must resolve its configured HTTPS model endpoint and API key');
assert(aiSupportSource.includes('if (!answer) answer = fallback(message, context, history)')&&aiSupportSource.includes('AI support is temporarily unavailable.'),'AI support must provide a safe fallback and a clear service-unavailable error');
for(const name of requiredClientInvokes) assert(client.includes("db.functions.invoke('"+name+"'"),'Client Edge Function wiring is missing for '+name);
assert(client.includes('Interaction and accessibility polish: consistent tap targets and keyboard focus'),'Client accessibility sizing styles are missing');
assert(client.includes('.btn{min-height:46px;'),'Primary buttons must have a consistent minimum height');
assert(client.includes('.btn.sm{min-height:40px}')&&client.includes('.chip{min-height:40px}'),'Compact button and chip touch targets must be enlarged');
assert(client.includes('.eye{width:40px;height:40px;min-width:40px;min-height:40px}'),'Balance visibility controls must have adequate touch targets');
assert(client.includes('.task-view-product{min-height:40px;')&&client.includes('.task-complete{min-height:40px;'),'Shop task controls must have adequate touch targets');
assert(client.includes('button:focus-visible,a:focus-visible'),'Keyboard focus indicators must be visible for interactive controls');
assert(client.includes('@media(max-width:360px)'),'Very narrow mobile layouts must have specific responsive adjustments');
assert(client.includes('linear-gradient(135deg,#c94932,#b83b7d)'),'Client primary action gradient must pass white-text contrast');
assert(client.includes('.bk{width:44px;height:44px;min-width:44px;min-height:44px}'),'Client back controls must have consistent touch targets');
assert(client.includes('./supabase-sdk.js'),'Client must load the pinned local Supabase SDK');
const androidBuild=fs.readFileSync('android/app/build.gradle','utf8');
assert(androidBuild.includes("include 'supabase-sdk.js'"),'Client Android assets must include the pinned Supabase SDK');
assert(androidBuild.includes("'Activate Selected Tier'"),'Android build guard must match the current tier UI');
assert(client.includes("provider:'google'")&&client.includes('data-google-auth'),'Client UI must offer a wired Google authentication button');
assert(client.includes('window.AegisSupabaseClient=db;')&&client.includes('window.AegisAuthRedirect={'),'Client must expose a same-session OAuth callback handler for the Android deep-link bridge');
assert(client.includes("com.aegispay.app.client://auth/callback")&&client.includes("new URL('/app/'"),'Google OAuth must have both native APK and canonical web callback URLs');
assert(client.includes("aegispay:auth-confirmed")&&client.includes("exchangeCodeForSession(code)"),'Google OAuth callbacks must exchange PKCE codes and resume the client session');
assert(client.includes('liveHome'),'Client Home runtime is missing');
assert(client.includes('liveTopup'),'Client Top Up runtime is missing');
assert(client.includes('liveWithdraw'),'Client Withdrawal runtime is missing');
assert(client.includes('Username or Email'),'Canonical client login must accept username or email');
assert(/<input id="le" type="text"[^>]*autocomplete="username"[^>]*autocapitalize="none"[^>]*spellcheck="false"[^>]*style="-webkit-text-security:none!important;text-security:none!important"/.test(client),'Client login identifier must remain readable and not use password text masking');
assert(/<input id="lp" type="password"/.test(client),'Client login password must remain masked');
assert(client.includes('#ov.show{display:flex}'),'Language and appearance sheets must override the hidden overlay ID style when opened');
assert(client.includes("function apLangSheet()")&&client.includes("if(a==='lang'){apLangSheet();return}")&&client.includes("localStorage.setItem('ap-lang',apLang)"),'Language picker must open, allow language selection, and persist the selected language');
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
assert(productionReadinessFunction.includes('PRODUCTION_DEPOSITS_REQUIRE_PAYOUT_READINESS')&&productionReadinessFunction.includes('mainnetDepositEnablementReady'),'Mainnet deposits must not be enabled before production payout readiness');
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
const depositVerifySource=fs.readFileSync('supabase/functions/verify-deposit/index.ts','utf8');
const depositSubmitSource=fs.readFileSync('supabase/functions/submit-deposit/index.ts','utf8');
const depositReadinessSource=fs.readFileSync('supabase/functions/production-readiness/index.ts','utf8');
const accessLogSource=fs.readFileSync('supabase/functions/record-user-access/index.ts','utf8');
assert(accessLogSource.includes('event_type: eventType'), 'User access event logger must persist the declared eventType using the database event_type column');
const telegramApproverSplitter = String.raw`split(/[\s,]+/)`;
assert(depositSubmitSource.includes(telegramApproverSplitter) && depositMonitorSource.includes(telegramApproverSplitter),'Telegram approver IDs must parse whitespace or comma separators correctly');
const depositSafetyMigration=fs.readFileSync('database/migrations/20261013_gate_mainnet_deposits_on_payout_readiness.sql','utf8');
const depositEnablementMigration=fs.readFileSync('database/migrations/20261013_fix_deposit_enablement_gate_and_txid_uniqueness.sql','utf8');
assert(depositEnablementMigration.includes("v_contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'")&&depositEnablementMigration.includes('Live mainnet deposits require approved PRODUCTION mode'),'Direct production-config RPC must enforce the official USDT contract and payout-readiness gate');
assert(client.includes('Deposits temporarily paused')&&client.includes('settings.production_config'),'Client must hide the Mainnet deposit wallet until payout readiness is approved');
assert(depositSubmitSource.includes('MAINNET_DEPOSITS_PAUSED')&&depositSubmitSource.includes('payoutCredentialsReady'),'Deposit submission must fail closed when production payouts are not ready');
assert(depositMonitorSource.includes('MAINNET_DEPOSITS_PAUSED')&&depositMonitorSource.includes('production.payouts_locked === false'),'Deposit monitor must not credit Mainnet deposits while payouts are locked');
assert(depositVerifySource.includes('MAINNET_DEPOSITS_PAUSED')&&depositVerifySource.includes('production.payouts_locked === false')&&depositVerifySource.includes('payoutCredentialsReady'),'Direct Mainnet deposit verification must enforce the same production payout-readiness gate');
const mainnetGateAndPayoutApproval = /mode\.live_deposits\s*===\s*true\s*&&\s*mode\.real_payouts\s*===\s*true\s*&&\s*mode\.production_go_live_approved\s*===\s*true/;
assert(mainnetGateAndPayoutApproval.test(depositVerifySource),'Direct Mainnet verification must AND all deposit/payout readiness flags');
assert(mainnetGateAndPayoutApproval.test(depositMonitorSource),'Mainnet monitor must AND all deposit/payout readiness flags');
assert(depositSubmitSource.includes('mainnetTokenContract !== MAINNET_USDT')&&depositSubmitSource.includes('UNSUPPORTED_MAINNET_TOKEN_CONTRACT'),'Mainnet deposit submission must require the exact official TRON USDT token contract');
assert(depositMonitorSource.includes('mainnetTokenContract !== MAINNET_USDT')&&depositMonitorSource.includes('UNSUPPORTED_MAINNET_TOKEN_CONTRACT'),'Mainnet monitor must require the exact official TRON USDT token contract');
assert(depositVerifySource.includes('mainnetTokenContract !== MAINNET_USDT')&&depositVerifySource.includes('UNSUPPORTED_MAINNET_TOKEN_CONTRACT'),'Direct Mainnet verification must require the exact official TRON USDT token contract');
assert(depositReadinessSource.includes('mainnetUsdtContractOk')&&depositReadinessSource.includes('mainnetBaseConfigOk')&&depositReadinessSource.includes('mainnet_usdt_contract_ok'),'Production readiness must fail closed and report official USDT token-contract readiness');
assert(depositSafetyMigration.includes('Live mainnet deposits require approved PRODUCTION mode')&&depositSafetyMigration.includes('PRE_PRODUCTION_PAYOUTS_LOCKED'),'Database settings RPC and current Mainnet configuration must fail closed');
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
assert(payout.includes('if (profile.role !== "MASTER ADMIN")')&&payout.includes('ownRequest.ai_decision !== "AUTO_APPROVED"'),'Non-admin payout execution must be restricted to the authenticated client’s own AI-approved request');
assert(payout.includes('ownRequest.panel_decision !== "APPROVED"')&&payout.includes('ownRequest.telegram_decision !== "APPROVED"')&&payout.includes('ownRequest.payout_txid'),'AI payout path must require all approvals and no existing payout TXID');
assert(payout.includes('const finalGateOpen =')&&payout.includes('finalProduction.payouts_locked === false')&&payout.includes('finalRuntimeEnabled === true'),'Payout must re-check production lock and runtime immediately before broadcast');

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

const signupSource=fs.readFileSync('supabase/functions/public-signup/index.ts','utf8');

const usernameLoginSource=fs.readFileSync('supabase/functions/username-login/index.ts','utf8');
const adminAccountOpsSource=fs.readFileSync('supabase/functions/admin-account-ops/index.ts','utf8');
for(const [source,label] of [[signupSource,'signup'],[usernameLoginSource,'username login']]){
  assert(source.includes('function trustedClientIp(req: Request)')&&source.includes('req.headers.get("cf-connecting-ip")'),'Trusted Cloudflare client IP handling is missing from '+label);
  assert(source.includes('forwardedFor[forwardedFor.length - 1]'),'Forwarded IP fallback must use the right-most gateway-appended address for '+label);
  assert(!source.includes('.split(",")[0].trim()'),'Client-controlled first X-Forwarded-For entry must not drive '+label+' throttling');
}
assert(adminAccountOpsSource.includes('auth.user.email_confirmed_at')&&adminAccountOpsSource.includes('A confirmed Auth email is required to repair the Master Admin link.'),'Master Admin email-link recovery must require a confirmed Auth email');
assert(adminAccountOpsSource.includes('String(candidate.email||"").trim().toLowerCase()===normalizedAuthEmail'),'Master Admin email recovery must strictly match normalized email after wildcard lookup');


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


assert(client.includes('const qr=(address)=>')&&client.includes('wallet?qr(wallet)'),'Deposit QR must be generated from the configured receiving address, not a hard-coded image');
assert(client.includes('encodeURIComponent(wallet)'),'Active deposit flow must encode its configured wallet into the QR generator URL');
assert(!client.includes('DEPOSIT_QR')&&!client.includes('TPr8f6Qx2J9mN4kR7vY8sZmU'),'Legacy deposit UI must not contain a hard-coded QR or receiving address');
assert(!client.includes('globalActivityFeed')&&!client.includes('aegisActivityTicker')&&!client.includes("Olivia - UK"),'Client must not show simulated deposits/withdrawals as real user activity');
assert(!client.includes('timed demo activity ticker'),'Legacy code comments must not advertise the removed simulated ticker as active functionality');

assert(signupSource.includes('pruneExpiredRateLimits(now)'), 'Public signup must periodically prune expired in-memory rate-limit keys');
assert(signupSource.includes('now - lastSeen >= 15_000') && signupSource.includes('now - lastSeen >= 60_000'), 'Signup rate-limit cleanup must preserve existing IP and email cooldown windows');

const withdrawalHardening=fs.readFileSync('database/migrations/20261013_harden_withdrawal_dual_approval_ledger.sql','utf8');
assert(withdrawalHardening.includes("account_ledger_withdrawal_debit_reference_uq"),'Withdrawal debit references must be unique per withdrawal');
assert(withdrawalHardening.includes("status = 'PENDING_APPROVAL'")&&withdrawalHardening.includes("w.telegram_decision = 'APPROVED'"),'Master Admin and Telegram must be distinct approval gates');
assert(withdrawalHardening.includes("TELEGRAM_HUMAN_APPROVAL_REQUIRED")&&withdrawalHardening.includes("'decision', 'MANUAL_REVIEW'"),'AI must fail closed to human withdrawal approval');
assert(withdrawalHardening.includes("current_platform_balance = current_platform_balance - w.amount")&&withdrawalHardening.includes("withdrawal_held = withdrawal_held - w.amount"),'Withdrawal deductions/releases must be exact and must not clamp with GREATEST');
assert(withdrawalHardening.includes("'WITHDRAWAL_DEBIT'")&&withdrawalHardening.includes("-w.amount"),'Every actual withdrawal deduction must have a negative ledger debit');
assert(withdrawalHardening.includes("Insufficient balance, inactive user, or inconsistent withdrawal reservation"),'Withdrawal approval must fail closed on invalid balance/hold state');
assert(withdrawalHardening.includes("FROM PUBLIC, anon, service_role")&&withdrawalHardening.includes("TO authenticated"),'Master Admin RPC must not be executable through anon or service_role roles');
assert(withdrawalHardening.includes("FROM PUBLIC, anon, authenticated")&&withdrawalHardening.includes("TO service_role"),'Telegram decision and AI RPCs must remain service-role only');

const depositCreditFix=fs.readFileSync('database/migrations/20261013_fix_deposit_enablement_gate_and_txid_uniqueness.sql','utf8');
assert(depositCreditFix.includes("SET search_path TO ''"),'Verified deposit credit function must use an empty fixed search_path');
assert(depositCreditFix.includes("COALESCE((v_mode ->> 'live_deposits')::BOOLEAN,FALSE)")&&!depositCreditFix.includes("COALESCE((v_mode ->> 'real_payouts')::BOOLEAN,FALSE) IS NOT TRUE"),'MAINNET credit must use the live-deposit flag, not a payout flag');
assert(depositCreditFix.includes('CREATE UNIQUE INDEX IF NOT EXISTS deposit_submissions_network_txid_uq'),'Deposit credit must have a database-enforced unique chain transaction reference');
assert(depositCreditFix.includes('NULLIF(btrim(network), \'\') IS NULL')&&depositCreditFix.includes('manual reconciliation before adding the unique index'),'Legacy submissions without a network must fail closed before the unique index is added');
assert(depositCreditFix.includes("FROM public.platform_settings WHERE key = 'referral_rules'")&&depositCreditFix.includes('v_l1')&&depositCreditFix.includes('v_l2'),'Deposit migration must preserve configurable referral reward values');
assert(depositCreditFix.includes("v_contract <> 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'"),'Mainnet deposit credit must reject any token other than official TRON USDT');
assert(depositCreditFix.includes("v_contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'")&&depositCreditFix.includes('v_mainnet_ready'), 'Production SQL go-live gate must require the official TRON USDT contract');
assert(fs.readFileSync('scripts/sql-tests/deposit_migration_assertions.sql','utf8').includes('Production go-live accepted a non-USDT Mainnet token contract'),'SQL integration tests must reject a fake Mainnet token contract before go-live');
assert(fs.readFileSync('scripts/sql-tests/deposit_migration_assertions.sql','utf8').includes('Fake Mainnet token contract was credited as USDT'),'SQL integration tests must prevent fake Mainnet tokens from being credited as USDT');
assert(depositCreditFix.includes('REVOKE ALL ON FUNCTION public.apply_verified_deposit')&&depositCreditFix.includes('TO service_role'),'Deposit credit RPC must not default to PUBLIC execution and must grant service_role explicitly');
assert(depositCreditFix.includes("length(COALESCE(btrim(d.txid),'')) <> 64")&&depositCreditFix.includes("^[A-Fa-f0-9]+$")&&depositCreditFix.includes("v_chain_amount := p_raw_amount::numeric / 1000000")&&depositCreditFix.includes("v_chain_amount <> d.gross_amount"),'Deposit credit must validate the chain transaction hash and exact raw USDT amount at the database boundary');
assert(depositCreditFix.includes("Deposit network differs from current settings")&&depositCreditFix.includes("Deposit submission has no recorded network"),'Deposit credit must fail closed if the submitted chain no longer matches deposit settings');
assert(fs.readFileSync('scripts/sql-tests/deposit_migration_assertions.sql','utf8').includes('Deposit network change was accepted'),'Disposable SQL tests must cover configuration drift between submission and verification');
assert(fs.readFileSync('scripts/sql-tests/deposit_migration_assertions.sql','utf8').includes('Raw chain amount mismatch was accepted'),'Disposable SQL tests must cover raw chain amount mismatch');
assert(fs.readFileSync('scripts/sql-tests/deposit_migration_assertions.sql','utf8').includes('Malformed chain transaction ID was accepted'),'Disposable SQL tests must cover malformed transaction IDs');
assert(depositSubmitSource.includes('network: depositNetwork'),'Deposit submission must persist the selected network before verification');
assert(depositSubmitSource.includes('amountInput')&&depositSubmitSource.includes('Number.isSafeInteger(Math.round(amount * 100))'),'Deposit submission must reject excess decimal precision and unsafe numeric inputs');
assert(fs.readFileSync('.github/workflows/sql-migration-tests.yml','utf8').includes('postgres:17'),'Deposit SQL migrations must be tested on a disposable PostgreSQL service');

console.log('AegisPay canonical architecture validation: PASS');
assert(!fs.existsSync('netlify.toml'),'Obsolete Netlify production configuration must not return to canonical main');

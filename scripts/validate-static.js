const fs=require('node:fs');
const vm=require('node:vm');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const exists=p=>fs.existsSync(p);
const packageManifest=JSON.parse(fs.readFileSync('package.json','utf8'));
const appVersionManifest=JSON.parse(fs.readFileSync('app-version.json','utf8'));
assert(packageManifest.version===appVersionManifest.versionName,'package.json and app-version.json must use the same candidate version');

const must=[
  'client.html','master-admin.html','admin-auth.js','aegis-turnstile.js','scripts/client-browser-smoke.cjs',
  'supabase-client.js','supabase-service.js','aegis-auth-redirect.js','app-update.js',
   'service-worker.js','manifest.webmanifest','_headers','aegispay-logo.svg','_redirects','app-version.json','package.json',
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
  'database/migrations/20261018195540_restrict_legacy_admin_definer_rpcs.sql',
  'scripts/sql-tests/legacy_definer_rpc_fixture.sql',
  'scripts/sql-tests/legacy_definer_rpc_assertions.sql',
  '.github/workflows/security-definer-rpc-tests.yml',
  'database/migrations/20261013_gate_mainnet_deposits_on_payout_readiness.sql',
  'database/migrations/20261013_fix_deposit_enablement_gate_and_txid_uniqueness.sql',
  'database/migrations/20261014_phase1_validate_withdrawal_wallets.sql',
  'database/migrations/20261014120000_revoke_trigger_only_function_execute.sql',
  'database/migrations/20261014150000_google_oauth_profile_linking.sql',
  'database/migrations/20261014174000_fix_google_oauth_username_generation.sql',
  'database/migrations/20261017163000_support_facebook_oauth_profiles.sql',
  'database/migrations/20261015_ai_support_live_chat.sql',
  'database/migrations/20261015_ai_support_live_chat.sql',
  'database/migrations/20261017150927_hd_deposit_wallets_20261016120000.sql',
  'database/migrations/20261017150938_hd_deposit_sweep_journal_20261017100000.sql',
  'supabase/functions/get-deposit-address/index.ts',
  'supabase/functions/_shared/auth-login-error.ts','supabase/functions/_shared/auth-login-error_test.ts',
  'supabase/functions/_shared/tron-hd-wallet.ts',
  'supabase/functions/_shared/tron-hd-wallet_test.ts',
  'supabase/functions/_shared/tron-sweep.ts',
  'supabase/functions/_shared/tron-sweep_test.ts',
  'supabase/functions/sweep-deposit-wallets/index.ts',
  'docs/hd-tron-deposit-wallets.md',
  'scripts/sql-tests/hd_deposit_sweep_assertions.sql',
  'scripts/sql-tests/deposit_migration_fixture.sql',
  'scripts/sql-tests/deposit_migration_assertions.sql',
  'scripts/sql-tests/deposit_monitor_cron_fixture.sql',
  'scripts/sql-tests/deposit_monitor_cron_assertions.sql',
  'database/migrations/20261015222625_deposit_monitor_skip_when_gates_closed.sql',
  'database/migrations/20261015222642_guard_manual_balance_reversals.sql',
  'database/migrations/20261015222721_lock_ai_support_message_client_access.sql',
  '.github/workflows/sql-migration-tests.yml',
  'docs/recovered-sql/ensure_auto_task_cycle_live_reference_20261013.sql',
  'scripts/sql-tests/withdrawal_migration_fixture.sql',
  'scripts/sql-tests/withdrawal_migration_assertions.sql',
  'supabase/functions/production-readiness/index.ts',
  'supabase/functions/_shared/pwned-passwords.ts','supabase/functions/_shared/pwned-passwords_test.ts',
  'supabase/functions/_shared/password-policy.ts','supabase/functions/_shared/password-policy_test.ts',
  'supabase/functions/submit-kyc/ai-review.ts','supabase/functions/submit-deposit/ai-review.ts',
  'workers/aegispay-web/index.js','workers/aegispay-web/wrangler.jsonc','scripts/check-web-proxy.js',
  'site/index.html','site/site.css','android/app/build.gradle',
  'android/app/src/main/java/com/aegispay/app/MainActivity.java',
  '.github/workflows/ci.yml','.github/workflows/android-apk.yml',
  '.github/workflows/web-portal-deploy.yml','.github/workflows/website-apk-release.yml','.github/workflows/withdrawal-migration-tests.yml'
];
for(const p of must)assert(exists(p),'Missing canonical source file: '+p);

const weightedTaskReference=fs.readFileSync('docs/recovered-sql/ensure_auto_task_cycle_live_reference_20261013.sql','utf8');
assert(weightedTaskReference.includes('REFERENCE SNAPSHOT ONLY')&&weightedTaskReference.includes('NOT THE ORIGINAL MIGRATION SOURCE'),'Recovered weighted Shop function must remain explicitly marked as reference-only');
assert(weightedTaskReference.includes('so.task_weight')&&weightedTaskReference.includes('weight_sum'),'Recovered weighted Shop function must preserve product-weighted allocation logic');

const legacyDefinerRpcMigration=fs.readFileSync('database/migrations/20261018195540_restrict_legacy_admin_definer_rpcs.sql','utf8');
for(const sig of [
  'public.ai_update_display_name(text)',
  'public.finalize_withdrawal(uuid, boolean)',
  'public.get_production_readiness()',
  'public.master_admin_adjust_balance(uuid, numeric, text, text)',
  'public.set_production_config(text, boolean, boolean, boolean, boolean)'
])assert(legacyDefinerRpcMigration.includes('REVOKE ALL PRIVILEGES ON FUNCTION '+sig+' FROM authenticated'),'Legacy SECURITY DEFINER RPC must not be directly executable by authenticated users: '+sig);
assert(!legacyDefinerRpcMigration.includes('FROM service_role'),'Legacy RPC hardening must preserve existing trusted backend grants.');
const legacyDefinerRpcTestWorkflow=fs.readFileSync('.github/workflows/security-definer-rpc-tests.yml','utf8');
const legacyDefinerRpcSqlAssertions=fs.readFileSync('scripts/sql-tests/legacy_definer_rpc_assertions.sql','utf8');
assert(legacyDefinerRpcTestWorkflow.includes('legacy_definer_rpc_fixture.sql')&&legacyDefinerRpcTestWorkflow.includes('20261018195540_restrict_legacy_admin_definer_rpcs.sql')&&legacyDefinerRpcTestWorkflow.includes('legacy_definer_rpc_assertions.sql'),'SECURITY DEFINER permission migration must run in a disposable PostgreSQL CI test.');
assert(legacyDefinerRpcSqlAssertions.includes('Trusted service-role grants changed unexpectedly')&&legacyDefinerRpcSqlAssertions.includes('Authenticated RLS identity helper grants must be preserved'),'SECURITY DEFINER permission tests must preserve backend access and RLS helper access.');

const triggerOnlyGrantMigration=fs.readFileSync('database/migrations/20261014120000_revoke_trigger_only_function_execute.sql','utf8');
assert(triggerOnlyGrantMigration.includes('REVOKE ALL ON FUNCTION public.enforce_valid_tron_withdrawal_address()'),'Trigger-only wallet validator must not remain callable as an RPC');
assert(/FROM PUBLIC, anon, authenticated\s*;/i.test(triggerOnlyGrantMigration),'Trigger-only wallet validator must revoke public and authenticated client execution');
assert(!/^\s*FROM\b[^\n]*service_role/im.test(triggerOnlyGrantMigration),'Keep service_role maintenance permission for controlled trigger maintenance');
const googleOAuthMigration=fs.readFileSync('database/migrations/20261014150000_google_oauth_profile_linking.sql','utf8');
assert(googleOAuthMigration.includes("NEW.raw_app_meta_data ->> 'provider', '')) = 'google'")&&googleOAuthMigration.includes('NEW.email_confirmed_at IS NOT NULL'),'Google OAuth profile changes must only apply to Google identities with verified email');
assert(googleOAuthMigration.includes('auth_user_id = NEW.id')&&googleOAuthMigration.includes('auth_user_id IS NULL')&&googleOAuthMigration.includes("upper(status) <> 'DELETED'")&&googleOAuthMigration.includes("role = 'USER'"),'Google OAuth must only claim matching unlinked non-deleted profiles');
assert(googleOAuthMigration.includes('v_username_base')&&googleOAuthMigration.includes('v_username_suffix')&&googleOAuthMigration.includes('regexp_replace'),'New Google OAuth signups must receive a unique generated Client ID when metadata has no username');
const googleUsernameFixMigration=fs.readFileSync('database/migrations/20261014174000_fix_google_oauth_username_generation.sql','utf8');
assert(googleUsernameFixMigration.includes("NEW.email_confirmed_at IS NOT NULL")&&googleUsernameFixMigration.includes("AND role = 'USER'"),'Google OAuth existing-profile linking must remain limited to confirmed emails and USER role');
assert(googleUsernameFixMigration.includes("NEW.raw_app_meta_data -> 'providers', '[]'::jsonb) @> '[\"google\"]'::jsonb")&&googleUsernameFixMigration.includes("IF lower(COALESCE(NEW.raw_app_meta_data ->> 'provider', '')) = 'google'"),'Google username generation must rely on trusted Supabase Google provider metadata, not the email-confirmation timestamp');
const facebookOAuthMigration=fs.readFileSync('database/migrations/20261017163000_support_facebook_oauth_profiles.sql','utf8');
assert(facebookOAuthMigration.includes("IN ('google', 'facebook')")&&facebookOAuthMigration.includes("NEW.email_confirmed_at IS NOT NULL"),'Facebook profile linking must only claim matching unlinked client profiles when Auth confirms the email');
assert(facebookOAuthMigration.includes("'[\"facebook\"]'::jsonb")&&facebookOAuthMigration.includes('v_username_suffix'),'Facebook OAuth users must be recognized from trusted provider metadata and receive unique generated usernames');
assert(!googleUsernameFixMigration.includes("AND NEW.email_confirmed_at IS NOT NULL THEN\n      v_username_base"),'Google username generation must tolerate email_confirmed_at being unset during the initial Auth insert');

const cloudflareDeployWorkflow=fs.readFileSync('.github/workflows/web-portal-deploy.yml','utf8');
const apkReleaseWorkflow=fs.readFileSync('.github/workflows/website-apk-release.yml','utf8');
assert(cloudflareDeployWorkflow.includes("if: github.ref == 'refs/heads/main'"),'Production Cloudflare deployment must be restricted to the main branch even for manual dispatch');
assert(apkReleaseWorkflow.includes("if: github.ref == 'refs/heads/main'"),'APK release publication must be restricted to the main branch even for manual dispatch');

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
const landingPage=fs.readFileSync('site/index.html','utf8');
const stablePortal='https://aegispay-web.aegispay.workers.dev';
assert((landingPage.match(/href="https:\/\/aegispay-web\.aegispay\.workers\.dev\/app\//g)||[]).length>=3&&!landingPage.includes('href="/app/"'),
  'All public Client Portal CTAs must use the stable workers.dev front door instead of the canonical Pages or per-deployment preview host.');
const serviceWorker=fs.readFileSync('service-worker.js','utf8');
const shopWorkerPage=fs.readFileSync('workers/aegispay-shopping/shop.html','utf8');
const taskImageBinder=client.slice(client.indexOf('function bindTaskImageFallback(root){'),client.indexOf('function bindTaskDelegation()',client.indexOf('function bindTaskImageFallback(root){')));
assert(client.includes('function aegisClientReturnUrl()')&&client.includes("url.searchParams.set('aegisReturnPage',route)")&&client.includes("window.__aegisCurrentRoute=route"),'Shop navigation must preserve the Client SPA route across the external marketplace return.');
assert(client.includes("const requestedReturnPage=normalizeAegisReturnPage(qs.get('aegisReturnPage'))")&&client.includes('await window.go(requestedReturnPage)')&&client.includes('attempt<5&&!s.data.session'),'Returning from Shop must retry Auth session hydration briefly, then restore the requested screen instead of always opening Home.');
assert(!taskImageBinder.includes('new Image()')&&taskImageBinder.includes('img.src=remote'),'Assigned Shop product images must load directly without a separate image-probe request.');
assert(shopWorkerPage.includes('const FAST_REAL_IMAGES=')&&shopWorkerPage.includes('ITEMS.forEach(function(product){product.photo=fastRealPhoto(product);});'),'Marketplace must seed real image URLs synchronously while its full catalog loads in the background.');
assert(shopWorkerPage.includes("index<4?'eager':'lazy'")&&shopWorkerPage.includes('fetchpriority="${index<4?\'high\':\'auto\'}"'),'Marketplace must prioritize the above-the-fold product images.');

const startupSource=client.slice(client.indexOf('async function initData(){'),client.indexOf('\nfunction top(',client.indexOf('async function initData(){')));
assert(startupSource.includes('const [userResult,s,t]=await Promise.all([')&&startupSource.includes('void refreshNotificationCount();'),'Authenticated startup must load profile-related data concurrently and refresh the notification count without blocking page rendering.');
assert(client.includes('async function refreshClientProfile()')&&client.includes('await refreshClientProfile(); await liveShop();')&&client.includes("await refreshClientProfile();\n   await liveShop();"),'Shop tier/task/cycle actions must refresh only the changed profile before reloading Shop data.');
assert(serviceWorker.includes("const CACHE='aegispay-shell-v32-compact-support-chat'")&&serviceWorker.includes("'./aegis-turnstile.js'")&&serviceWorker.includes("'./app/aegis-turnstile.js'")&&serviceWorker.includes('Promise.all(ASSETS.map(asset=>cache.add(asset).catch(()=>undefined)))'),'Fast app-shell cache must be versioned, precache the root and /app/ auth helpers, and install assets concurrently.');
assert(serviceWorker.includes('const update=fetch(event.request,{cache:\'no-store\'})')&&serviceWorker.includes('caches.match(cacheKey).then(cached=>cached||update.catch')&&serviceWorker.includes('cacheUrl.search=\'\';'),'Static shell requests must be served from cache first, refresh in the background, and avoid caching URL query tokens.');
assert(serviceWorker.includes("['code','access_token','refresh_token','token_hash','error','error_description']")&&serviceWorker.includes('const shouldStore=!authSensitive&&!isAuthCallback'),'OAuth and recovery URLs must never be stored as distinct cached requests.');
assert(client.includes("navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'})")&&masterAdmin.includes("navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'})"),'Web client and Master Admin must register the non-blocking app-shell cache after page load.');
assert(client.includes("entryType==='MASTER_ADMIN_CREDIT'")&&client.includes("label:adminCredit?'Deposit':")&&client.includes("status:adminCredit?'':x.entry_type||''")&&client.includes("filter=adminCredit?'dep':"),'Positive admin-issued credits must show only Deposit and belong to the Deposits filter');
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
assert(!client.includes('The assistant provides guidance and troubleshooting. It cannot edit balances or approve/reject withdrawals.')&&!client.includes('id="aiOnline"')&&client.includes('id="aiRepresentativeStatus"'),'AI Assistant must remove duplicate top banners while retaining concise representative/error status in the support panel');
assert(client.includes('id="aiRepresentative"')&&client.includes('Talk to a Customer Representative'),'Client must offer an explicit customer representative escalation path');
assert(client.includes("action:'create_support_case'")&&client.includes('awaitingRepresentativeIssue')&&client.includes('submitRepresentativeRequest'),'Client must submit prior chat context or ask for issue details before creating a support case');
assert(client.includes('class="ai-input-shell"'),'AI input must use a dedicated, evenly framed pink shell (layout geometry is checked in Playwright)');
assert(client.includes('function refreshAiLiveSupportState')&&client.includes('function sendLiveSupportMessage')&&client.includes('client_live_support_state')&&client.includes('client_send_chat_message'),'Client must poll and send messages in the shared representative conversation');
assert(client.includes('function forgetAiLiveCaseReference()')&&client.includes("sessionStorage.removeItem(aiLiveStorageKey('case'))")&&client.includes('forgetAiLiveCaseReference();'),'Resolved or unavailable representative chats must clear stale session pointers so new messages can be routed normally.');
assert(client.includes('A representative is now live in this chat.')&&client.includes('Message your representative...'),'Client must visibly show representative presence and switch the composer to live chat');
assert(client.includes('async function openAegisSupport()')&&client.slice(client.indexOf('async function openAegisSupport()'),client.indexOf('async function openAegisSupport()')+1600).includes('startAiLiveSupportPolling()'),'Actual AI route must start live-chat polling');
assert(client.includes('function refreshAiLiveSupportState')&&client.includes('function sendLiveSupportMessage')&&client.includes('client_live_support_state')&&client.includes('client_send_chat_message'),'Client must poll and send messages in the shared representative conversation');
assert(client.includes('A representative is now live in this chat.')&&client.includes('Message your representative...'),'Client must visibly show representative presence and switch the composer to live chat');
assert(client.includes('A representative may contact you soon.')&&client.includes('function safeAiDisplayText'),'Client must use the approved representative message and sanitize prior AI history');
assert(!client.includes('Telegram notification sent to Master Admin.')&&!client.includes('Saved in the Master Admin queue; Telegram delivery was not confirmed.'),'Client support status must not expose internal routing details');
assert(client.includes("window.__aegisOpenNotificationById(notification.getAttribute('data-notification-id'))"),'Notification taps must open the selected notification by ID');
const notificationHeaderRoute="onclick=\"go(\\'notifications\\')\" aria-label=\"Notifications\"";
assert(client.split(notificationHeaderRoute).length-1>=2,'Home and detail headers must render clickable notification buttons.');

const requiredClientInvokes=['ai-support','complete-cycle-checkout','complete-password-reset','execute-payout','preproduction-activity-ticker','public-signup','record-user-access','submit-deposit','submit-kyc','telegram-withdrawal','username-login','withdrawal-ai-review'];
assert(client.includes('id="aiMessages"')&&client.includes('id="aiInput"')&&client.includes('id="aiSend"'),'AI Assistant must render its message panel, input, and send control');
assert(client.includes("+NV('bot')+'</div>'"),'AI Assistant template must use a navigation helper available in its own script scope');
assert(client.includes("db.functions.invoke('ai-support',{body:{message,history:previous}})"),'AI Assistant must submit its message and conversation history to ai-support');
assert(client.includes("button.onclick=()=>aiAsk(input?.value||'')"),'AI send button must invoke the AI request handler');
assert(client.includes("if(e.key==='Enter'&&!e.shiftKey)"),'AI input must support Enter-to-send without swallowing Shift+Enter');
assert(client.includes("document.addEventListener('click',function(e){const q=e.target.closest('[data-q]')"),'AI quick prompts must invoke the AI request handler');
const pwnedPasswordHelper=fs.readFileSync('supabase/functions/_shared/pwned-passwords.ts','utf8');
const publicSignupSource=fs.readFileSync('supabase/functions/public-signup/index.ts','utf8');
const passwordResetSource=fs.readFileSync('supabase/functions/complete-password-reset/index.ts','utf8');
const pwnedPasswordTests=fs.readFileSync('supabase/functions/_shared/pwned-passwords_test.ts','utf8');
const passwordPolicy=fs.readFileSync('supabase/functions/_shared/password-policy.ts','utf8');
const passwordPolicyTests=fs.readFileSync('supabase/functions/_shared/password-policy_test.ts','utf8');
const authLoginErrorSource=fs.readFileSync('supabase/functions/_shared/auth-login-error.ts','utf8');
const authLoginErrorTests=fs.readFileSync('supabase/functions/_shared/auth-login-error_test.ts','utf8');
const authUsernameLoginSource=fs.readFileSync('supabase/functions/username-login/index.ts','utf8');
const supabaseServiceSource=fs.readFileSync('supabase-service.js','utf8');
const turnstileHelper=fs.readFileSync('aegis-turnstile.js','utf8');
assert(pwnedPasswordHelper.includes('crypto.subtle.digest("SHA-1"')&&pwnedPasswordHelper.includes('https://api.pwnedpasswords.com/range/')&&pwnedPasswordHelper.includes('fullHash.slice(0, 5)'),'Password screening must query the HIBP range API using only a five-character SHA-1 prefix');
assert(pwnedPasswordHelper.includes('"Add-Padding": "true"')&&pwnedPasswordHelper.includes('PasswordSecurityUnavailableError'),'Password screening must request privacy padding and fail closed if the provider is unavailable');
assert(publicSignupSource.includes('assertPasswordNotPwned(password)')&&publicSignupSource.includes('COMPROMISED_PASSWORD')&&publicSignupSource.includes('PASSWORD_SECURITY_UNAVAILABLE'),'Signup must reject compromised passwords before creating an Auth user');
assert(passwordResetSource.includes('assertPasswordNotPwned(password)')&&passwordResetSource.includes('COMPROMISED_PASSWORD')&&passwordResetSource.includes('PASSWORD_SECURITY_UNAVAILABLE'),'Password reset must reject compromised passwords before changing the Auth password');
assert(passwordPolicy.includes('MIN_PASSWORD_LENGTH = 12')&&passwordPolicy.includes('MAX_PASSWORD_LENGTH = 128'),'Password creation and reset must share the 12-to-128-character policy');
assert(publicSignupSource.includes('passwordPolicyError(password)')&&passwordResetSource.includes('passwordPolicyError(password)'),'Signup and password reset must enforce the same server-side policy');
assert(passwordPolicyTests.includes('exactly 12 characters')&&passwordPolicyTests.includes('exactly 128 characters')&&passwordPolicyTests.includes('shorter than 12')&&passwordPolicyTests.includes('longer than 128'),'Password policy regression tests must cover minimum and maximum boundaries');
assert(publicSignupSource.includes('captchaToken: captchaToken || undefined')&&publicSignupSource.includes('passwordPolicyError(password)'),'Signup must forward the Supabase CAPTCHA token and apply server-side password rules');
assert(passwordResetSource.includes('passwordPolicyError(password)')&&passwordResetSource.includes('assertPasswordNotPwned(password)'),'Password reset must apply both the central policy and leaked-password check');
assert(turnstileHelper.includes('https://challenges.cloudflare.com/turnstile/v0/api.js')&&turnstileHelper.includes('requireToken')&&turnstileHelper.includes('window.turnstile.reset'),'Turnstile helper must render, require, and reset a one-use token');
assert(turnstileHelper.includes("var MANUAL_LOGIN_FORMS = new Set(['liveLogin', 'aaLoginForm'])")&&turnstileHelper.includes("execution: manual ? 'execute' : 'render'")&&turnstileHelper.includes("appearance: manual ? 'execute' : 'always'")&&turnstileHelper.includes("retry: manual ? 'never' : 'auto'")&&turnstileHelper.includes("'refresh-expired': 'auto'")&&turnstileHelper.includes("'refresh-timeout': 'auto'")&&turnstileHelper.includes('loadApi().catch(function (error)')&&turnstileHelper.includes('VERIFY_RETRY_LIMIT')&&turnstileHelper.includes('failOrRetryVerification')&&turnstileHelper.includes('armVerificationWatchdog')&&turnstileHelper.includes('state.pendingPromise')&&turnstileHelper.includes('state.wrap.dataset.challengeActive')&&turnstileHelper.includes('window.turnstile.execute(state.widgetId)')&&!turnstileHelper.includes('aegis-turnstile-verify-button'),'Client and Master Admin Login must prewarm Turnstile and retry verification automatically without a separate checkbox button');
assert(client.includes('if(captchaToken&&window.AegisTurnstile)window.AegisTurnstile.reset(login)')&&fs.readFileSync('admin-auth.js','utf8').includes('if(captchaToken&&loginForm&&loginForm.isConnected&&window.AegisTurnstile)'),'Login widgets must not reset when submission is blocked before a verification token is used');
assert(client.includes("return 'https://aegispay-web.aegispay.workers.dev/product-image?url='+encodeURIComponent(raw);"),'Client product images must use the dedicated Worker proxy instead of the static Pages origin');
assert(turnstileHelper.includes("host === 'localhost' || host === '127.0.0.1'")&&turnstileHelper.includes('1x00000000000000000000AA'),'Local browser tests must use Cloudflare test keys and production must retain its real sitekey.');
assert(client.includes('AegisTurnstile.requireToken(login)')&&client.includes('AegisTurnstile.requireToken(signup)')&&client.includes('AegisTurnstile.requireToken(forgot)'),'Client sign-in, sign-up, and password recovery must require Turnstile');
assert(client.includes('password.length<12||password.length>128')&&client.includes('minlength="12" maxlength="128"'),'Client password creation and recovery forms must enforce the shared 12–128 character policy.');
assert(client.includes("db.functions.invoke('public-signup'")&&client.includes("db.functions.invoke('complete-password-reset'"),'Client signup and recovery must route password creation/reset through the HIBP-enforced Edge Functions.');
assert(!/auth[.]signUp\s*\(/i.test(client),'Client must not bypass server-side password screening with direct Supabase signUp calls.');
assert(!/auth[.]updateUser\s*\(/i.test(client),'Client must not bypass server-side password screening with direct Supabase password updates.');
assert(client.includes('socialProviders')&&client.includes("['google','facebook']")&&client.includes('data-social-auth'),'Optional social login must support both providers and remain config-gated');
assert(fs.readFileSync('supabase/functions/username-login/index.ts','utf8').includes('options: { captchaToken: captchaToken || undefined }'),'Username authentication must forward CAPTCHA token to Supabase Auth');
assert(authUsernameLoginSource.includes('classifyAuthLoginError(authError)'),'Username login must distinguish CAPTCHA/rate-limit failures from invalid credentials');
assert(authLoginErrorSource.includes('CAPTCHA_VERIFICATION_FAILED')&&authLoginErrorSource.includes('AUTH_RATE_LIMITED')&&authLoginErrorSource.includes('INVALID_CREDENTIALS'),'Login error classifier must map CAPTCHA, rate-limit, and credential errors explicitly');
assert(authLoginErrorTests.includes('CAPTCHA_VERIFICATION_FAILED')&&authLoginErrorTests.includes('AUTH_RATE_LIMITED')&&authLoginErrorTests.includes('INVALID_CREDENTIALS'),'Login error classifier tests must cover each safe failure category');
assert(client.includes('Security verification could not be completed automatically.')&&fs.readFileSync('admin-auth.js','utf8').includes('Security verification could not be completed automatically.'),'Client and admin login must surface automatic CAPTCHA failures clearly instead of reporting bad credentials');
assert(client.includes("function emailVerificationRedirectTo(){")&&client.includes("return 'https://aegispay-pro.pages.dev/app/?verified=1';")&&client.includes("return 'https://aegispay-web.aegispay.workers.dev/app/?verified=1';")&&supabaseServiceSource.includes("function webPasswordResetRedirect(){")&&supabaseServiceSource.includes("return 'https://aegispay-pro.pages.dev/app/?reset=1';")&&supabaseServiceSource.includes("return 'https://aegispay-web.aegispay.workers.dev/app/?reset=1';"),'Verification and password-reset emails must choose a valid portal origin for canonical and fallback hosts');
assert(!client.includes("preferredLanguage:'en',redirectTo:'https://aegispay-web.aegispay.workers.dev/?verified=1'"),'Client must not send an unused signup redirect; the server-owned signup destination is canonical');

const pwnedPasswordTestsLower=pwnedPasswordTests.toLowerCase();
assert(pwnedPasswordTestsLower.includes('breached passwords are rejected')&&pwnedPasswordTestsLower.includes('only the first five hash characters')&&pwnedPasswordTestsLower.includes('fails closed'),'Password screening regression tests must cover breached, clean and unavailable cases');
const signupRedirectSource=fs.readFileSync('supabase/functions/public-signup/index.ts','utf8');
assert(signupRedirectSource.includes('const PRODUCTION_REDIRECT = "https://aegispay-web.aegispay.workers.dev/app/?verified=1";'),'Signup verification must use the stable proxy portal origin instead of sending users back to an unreachable Pages hostname');
assert(client.includes("function passwordResetRedirectTo(){")&&client.includes("return 'https://aegispay-pro.pages.dev/app/?reset=1';")&&client.includes("return 'https://aegispay-web.aegispay.workers.dev/app/?reset=1';")&&client.includes("redirectTo:passwordResetRedirectTo()"),'Password reset emails must use the current host route without breaking canonical Pages clients');
assert(client.includes("https://aegispay-web.aegispay.workers.dev/app/?ref=")&&!client.includes("const referralLink=code?'https://aegispay-pro.pages.dev/app/?ref="),'Shared referral URLs must use the stable workers.dev portal instead of the Pages hostname');
assert(client.includes("replace(/^#/,'').replace(/^\\?/,'')")&&client.includes('This password reset link has expired or has already been used.')&&client.includes("hashParams.has('error')"),'Password recovery must handle provider error fragments and explain expired links');
const aiSupportSource=fs.readFileSync('supabase/functions/ai-support/index.ts','utf8');
const depositEvidenceReview=fs.readFileSync('supabase/functions/submit-deposit/ai-review.ts','utf8');
const identityEvidenceReview=fs.readFileSync('supabase/functions/submit-kyc/ai-review.ts','utf8');
const withdrawalReviewSource=fs.readFileSync('supabase/functions/withdrawal-ai-review/index.ts','utf8');
const adminSource=fs.readFileSync('admin-auth.js','utf8');
assert(!aiSupportSource.includes('AI_REVIEW_ENDPOINT')&&!aiSupportSource.includes('AI_ASSISTANT_ENDPOINT')&&!aiSupportSource.includes('AI_REVIEW_API_KEY')&&!aiSupportSource.includes('await fetch(requestUrl'),'General AI Support must not call Claude; Claude is reserved for identity and deposit evidence review');
assert(depositEvidenceReview.includes('AI_REVIEW_ENDPOINT')&&depositEvidenceReview.includes('AI_REVIEW_API_KEY')&&depositEvidenceReview.includes('runVisionReview'),'Deposit evidence review must retain the configured server-side Claude review path');
assert(identityEvidenceReview.includes('AI_REVIEW_ENDPOINT')&&identityEvidenceReview.includes('AI_REVIEW_API_KEY')&&identityEvidenceReview.includes('runVisionReview'),'Identity evidence review must retain the configured server-side Claude review path');
assert(aiSupportSource.includes('function fallback(')&&aiSupportSource.includes('AI support is temporarily unavailable.'),'General support must provide deterministic fallback guidance and a clear service-unavailable error');
assert(aiSupportSource.includes('action === "create_support_case"')&&aiSupportSource.includes('CUSTOMER_REPRESENTATIVE'),'AI support backend must accept authenticated representative requests and classify their Telegram alerts');
assert(aiSupportSource.includes('Action required: Please contact this client and review the issue.'),'Internal support alerts must still notify the representative channel');
assert(aiSupportSource.includes('function sanitizeClientAnswer')&&aiSupportSource.includes('return /\\bmaster\\s+admin\\b|\\btelegram\\b/i.test(text)'),'Server must sanitize internal routing details from client-facing replies');
assert(aiSupportSource.includes('private-support-attachments')&&aiSupportSource.includes('SUPPORT_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024')&&aiSupportSource.includes('createSignedUrl(item.path, 1800)'),'Support attachments must be validated, stored privately, and exposed only through short-lived signed URLs');
assert(aiSupportSource.includes('SUPPORT_ATTACHMENT_MIME')&&aiSupportSource.includes('parseSupportAttachment')&&aiSupportSource.includes('saveSupportAttachment'),'Support attachments must enforce file type and size checks before private upload');
assert(aiSupportSource.includes('isWithdrawalRequestIntent(message)')&&withdrawalReviewSource.includes('requiresManualReview: true'),'Withdrawal-related requests must be escalated for manual review');
assert(withdrawalReviewSource.includes('MANUAL_ADMIN_REVIEW_ONLY')&&!withdrawalReviewSource.includes('auto_approve_withdrawal'),'The withdrawal review endpoint must enforce manual-only review and never auto-approve');
assert(client.includes('<div class="ai-composer"><button class="ai-attach-btn" id="aiAttach"')&&client.includes('id="aiAttachmentInput"')&&client.includes('aiSerializeAttachment')&&client.includes('.ai-composer > .ai-attach-btn { flex: 0 0 44px;')&&client.includes('visibility: visible !important; opacity: 1 !important;'),'Client AI chat must render a prominent standalone plus button with validated attachment flow');
assert(adminSource.includes('supportAttachmentRows(m.attachments)')&&!adminSource.includes('data-action="withdrawal-ai-toggle"'),'Admin live chat must display private signed attachments and must not expose an auto-approval toggle');
assert(aiSupportSource.includes('action === "admin_update_case"')&&aiSupportSource.includes('status, resolution: resolution || null'),'Support cases must continue to support Master Admin resolution and resolution notes');
assert(aiSupportSource.includes('action === "admin_join_live_chat"')&&aiSupportSource.includes('action === "admin_live_chat_state"')&&aiSupportSource.includes('action === "admin_send_chat_message"'),'Edge Function must authenticate Admin join, transcript and reply actions');
assert(aiSupportSource.includes('action === "client_live_support_state"')&&aiSupportSource.includes('action === "client_send_chat_message"'),'Edge Function must scope chat reads and sends to the requesting client');
assert(aiSupportSource.includes('A representative is now live in this chat.')&&aiSupportSource.includes('sender_role: "REPRESENTATIVE"'),'Joining a chat must post a visible system notification and save representative replies');
assert(aiSupportSource.includes('action === "admin_join_live_chat"')&&aiSupportSource.includes('action === "admin_live_chat_state"')&&aiSupportSource.includes('action === "admin_send_chat_message"'),'AI support Edge Function must authenticate Admin join, message load and reply actions');
assert(aiSupportSource.includes('action === "client_live_support_state"')&&aiSupportSource.includes('action === "client_send_chat_message"'),'AI support Edge Function must scope live-chat reads and sends to the requesting client');
assert(aiSupportSource.includes('A representative is now live in this chat.')&&aiSupportSource.includes('sender_role: "REPRESENTATIVE"'),'Joining a chat must post a visible system notification and save representative replies');
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
const androidMainActivity=fs.readFileSync('android/app/src/main/java/com/aegispay/app/MainActivity.java','utf8');
assert(androidMainActivity.includes('CookieManager.getInstance()')&&androidMainActivity.includes('setAcceptThirdPartyCookies(view, true)'),'Android WebView must permit Turnstile iframe cookie/storage behavior');
assert(androidBuild.includes("include 'aegis-turnstile.js'")&&androidBuild.includes("include 'supabase-sdk.js'"),'Client Android assets must include the Turnstile helper and pinned Supabase SDK');
assert(androidBuild.includes("'Activate Selected Tier'"),'Android build guard must match the current tier UI');
const socialAuthConfig=fs.readFileSync('supabase-client.js','utf8');
assert(client.includes("provider:provider")&&client.includes('data-google-auth')&&socialAuthConfig.includes("facebook:false"),'Client UI must offer Google OAuth and keep Facebook gated until provider credentials are configured');
assert(client.includes('window.AegisSupabaseClient=db;')&&client.includes('window.AegisAuthRedirect={'),'Client must expose a same-session OAuth callback handler for the Android deep-link bridge');
assert(client.includes("com.aegispay.app.client://auth/callback")&&client.includes("new URL('/app/'"),'Google OAuth must have both native APK and canonical web callback URLs');
assert(client.includes("aegispay:auth-confirmed")&&client.includes("exchangeCodeForSession(code)"),'Google OAuth callbacks must exchange PKCE codes and resume the client session');
assert(client.includes('liveHome'),'Client Home runtime is missing');
assert(client.includes('liveTopup'),'Client Top Up runtime is missing');
assert(client.includes('liveWithdraw'),'Client Withdrawal runtime is missing');
assert(client.includes('Username or Email'),'Canonical client login must accept username or email');
assert(client.includes('.chips{display:flex;gap:8px;margin-bottom:14px;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}')&&client.includes('.chips::-webkit-scrollbar{display:none;width:0;height:0}')&&client.includes('.chip{flex:0 0 auto;'),'Activity filters must hide visible horizontal scrollbar controls while preserving native horizontal touch scrolling and non-shrinking chips');
assert(client.includes('id="aegis-hide-horizontal-scrollbar-controls"')&&client.includes('.chips::-webkit-scrollbar-button:horizontal:decrement')&&client.includes('.chips::-webkit-scrollbar-button:horizontal:increment'),'Client Activity filters must explicitly hide both horizontal scrollbar arrow buttons and their track/thumb while preserving overflow scrolling');
assert(masterAdmin.includes('id="aegis-hide-horizontal-scrollbar-controls"')&&masterAdmin.includes('.aa-mobile-tabs::-webkit-scrollbar-button'),'Master Admin horizontal mobile navigation must hide native scrollbar buttons');
const shopPage=fs.readFileSync('workers/aegispay-shopping/shop.html','utf8');
assert(shopPage.includes('id="aegis-hide-horizontal-scrollbar-controls"')&&shopPage.includes('.cats::-webkit-scrollbar-button')&&shopPage.includes('.pills::-webkit-scrollbar-button'),'Shop category and filter strips must hide scrollbar controls while preserving swipe scrolling');
assert(/<input id="le" type="text"[^>]*autocomplete="off"[^>]*autocapitalize="none"[^>]*spellcheck="false"[^>]*readonly[^>]*aria-label="Username or Email \/ Client ID" required>/.test(client),'Client login identifier must start blank, resist autofill, and remain readable without a preset value');
assert(/<input id="lp" type="password"[^>]*autocomplete="off"[^>]*readonly[^>]*required>/.test(client),'Client login password must start blank and resist autofill while remaining masked');
assert(!/placeholder=["'](?:tryforsuccess1|[•*]{3,}|Enter (?:username|your password))/i.test(client),'Login fields must not display sample credentials or password-looking placeholders');
const clientScrollSources=[client,masterAdmin,fs.readFileSync('admin-auth.js','utf8'),fs.readFileSync('workers/aegispay-shopping/shop.html','utf8'),fs.readFileSync('site/index.html','utf8'),fs.readFileSync('site/site.css','utf8')].join('\n');
assert(!/class=["'][^"']*(?:scroll-(?:left|right|arrow|btn|button)|horizontal-scroll-(?:left|right|btn))[^"']*["']/i.test(clientScrollSources)&&!/(?:aria-label|title)=["']scroll (?:left|right)["']/i.test(clientScrollSources),'Dedicated left/right scroll buttons must not be reintroduced; native swipe/trackpad scrolling is preferred');
assert(client.includes('#ov.show{display:flex}'),'Language and appearance sheets must override the hidden overlay ID style when opened');
assert(client.includes("function apLangSheet()")&&client.includes("if(a==='lang'){apLangSheet();return}")&&client.includes("localStorage.setItem('ap-lang',apLang)"),'Language picker must open, allow language selection, and persist the selected language');
assert(client.includes("db.functions.invoke('username-login'"),'Username login must use the protected Edge Function');
assert(!client.includes('resolve_login_email'),'Client must not call the public username-to-email RPC');
assert(client.includes('public-signup'),'Canonical client signup function is not wired');
assert(client.includes('resetPasswordForEmail'),'Client password reset request is not wired');
assert(client.includes("reset=1"),'Client password reset redirect marker is missing');
assert(client.includes('exchangeCodeForSession'),'PKCE password reset handling is missing');
assert(client.includes("setSession({access_token:accessToken,refresh_token:refreshToken})"),'Implicit password recovery token handling is missing');
assert(client.includes("function passwordResetRedirectTo(){")&&client.includes("https://aegispay-pro.pages.dev/app/?reset=1")&&client.includes("https://aegispay-web.aegispay.workers.dev/app/?reset=1"),'Password reset must retain the canonical Pages and stable fallback Worker destinations');
assert(client.includes("qs.get('passwordUpdated')==='1'")&&client.includes('Password updated successfully. Please sign in using your new password.'),'Legacy password-reset callbacks must show a clear success message on the canonical login page.');
assert(signupRedirectSource.includes("https://aegispay-web.aegispay.workers.dev/app/?verified=1"),'Signup verification must return to the stable Worker portal');
assert(client.includes('https://aegispay-pro.pages.dev/app/?reset=1')&&client.includes('https://aegispay-web.aegispay.workers.dev/app/?reset=1')&&signupRedirectSource.includes('https://aegispay-web.aegispay.workers.dev/app/?verified=1'),'Password reset retains both supported origins and signup verification uses the stable fallback portal');
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
assert(client.includes("destination.searchParams.set('product',String(productId))"),'Shared Shop marketplace navigation must carry the assigned product ID');
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
assert(adminAuth.includes('support-chat-open')&&adminAuth.includes('support-chat-send')&&adminAuth.includes('Start Live Chat')&&adminAuth.includes('pollActiveSupportChat'),'Master Admin portal must start, render and poll the shared live support conversation');
assert(adminAuth.includes('support-chat-open')&&adminAuth.includes('support-chat-send')&&adminAuth.includes('Start Live Chat')&&adminAuth.includes('pollActiveSupportChat'),'Master Admin portal must start, render and poll the shared live support conversation');
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
assert(service.includes('https://aegispay-pro.pages.dev/app/?reset=1'),'Shared password reset redirect must use the canonical Pages app.');
assert(service.includes('https://aegispay-pro.pages.dev/app/?reset=1'),'Shared auth helper must preserve the verified canonical redirect.');

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
  'admin-queues','admin-review','admin-account-ops','ai-support','execute-payout','monitor-deposits','production-readiness','preproduction-activity-ticker','complete-cycle-checkout','complete-password-reset','get-deposit-address',
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
assert(client.includes('async function isPreProductionActivityTickerAllowed()')&&client.includes("db.functions.invoke('preproduction-activity-ticker',{body:{}})"),'The sample activity ticker must ask the server whether pre-production testing is permitted.');
const tickerGateSource=fs.readFileSync('supabase/functions/preproduction-activity-ticker/index.ts','utf8');
assert(tickerGateSource.includes('auth.getUser(token)')&&tickerGateSource.includes('String(profile.role || "").toUpperCase() !== "USER"'),'Ticker mode endpoint must authenticate and limit eligibility to active client profiles.');
assert(tickerGateSource.includes('String(production.environment || "").toUpperCase() === "PRE_PRODUCTION"')&&tickerGateSource.includes('production.real_payouts_enabled !== true')&&tickerGateSource.includes('production.live_deposits_enabled !== true')&&tickerGateSource.includes('production.payouts_locked === true'),'Server must fail closed unless production mode is explicitly locked.');
assert(client.includes("const action=activityTickerActionIndex++%2===0?'deposited':'withdrew'"),'The pre-production ticker must alternate deposit and withdrawal examples.');
assert(client.includes('function nextUniqueActivityName()')&&client.includes("sessionStorage.getItem('aegispay_activity_ticker_seen_v1')")&&client.includes('activityTickerNamesSeen.has(name)'),'Activity popup names must not repeat during a browser session.');
assert(client.includes('function startActivityTicker()')&&!client.includes('function startActivityTicker(){}')
  &&client.includes('30000')&&client.includes('7000'),
  'The activity popup must have an active 30-second interval and 7-second visibility timeout.');
assert(client.includes("startActivityTicker();")&&client.indexOf('startActivityTicker();')>client.indexOf("select('key,value_json').in('key',['deposit_rules','withdrawal_rules','app_runtime','production_config','system_mode'])"),'Activity ticker starts only after live pre-production settings are loaded.');
assert(client.includes("setAttribute('aria-live','polite')"),'Activity popup must announce updates accessibly.');
assert(client.includes("el.innerHTML='<span class=\"tag\">User</span>"),'The activity popup must use only the requested User label.');

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
const hdWalletSource=fs.readFileSync('supabase/functions/_shared/tron-hd-wallet.ts','utf8');
const hdWalletEndpoint=fs.readFileSync('supabase/functions/get-deposit-address/index.ts','utf8');
const hdWalletMigration=fs.readFileSync('database/migrations/20261017150927_hd_deposit_wallets_20261016120000.sql','utf8');
assert(hdWalletSource.includes("m/44'/195'/0'/0")&&hdWalletSource.includes('TronWeb.fromMnemonic'),'HD wallet derivation must use the TRON BIP44 path');
assert(hdWalletEndpoint.includes('TRON_HD_WALLET_MNEMONIC')&&hdWalletEndpoint.includes('HD_WALLET_ROOT_MISMATCH'),'HD endpoint must require a server-side seed and fail closed on root mismatch');
assert(!hdWalletEndpoint.includes('return json({ privateKey')&&!hdWalletEndpoint.includes('privateKey: identity.privateKey'),'HD address API must never return derived private keys');
assert(hdWalletMigration.includes('ENABLE ROW LEVEL SECURITY')&&hdWalletMigration.includes('FROM PUBLIC, anon, authenticated')&&hdWalletMigration.includes('TO service_role'),'HD mapping must be private to privileged backend roles');
assert(depositSubmitSource.includes('deposit_wallet_id: depositWallet.id')&&depositSubmitSource.includes('receiving_address: receivingAddress'),'New deposits must snapshot their assigned HD recipient');
assert(depositMonitorSource.includes('deposit.receiving_address')&&depositVerifySource.includes('DEPOSIT_RECIPIENT_MISMATCH'),'Deposit verification must use assigned recipient');
assert(payoutSource.includes('PAYOUT_TREASURY_MISMATCH')&&payoutSource.includes('signerAddress !== configuredTreasury'),'Payout must fail closed on signer/treasury mismatch');

const sweepWorker=fs.readFileSync('supabase/functions/sweep-deposit-wallets/index.ts','utf8');
const sweepHelper=fs.readFileSync('supabase/functions/_shared/tron-sweep.ts','utf8');
const sweepTests=fs.readFileSync('supabase/functions/_shared/tron-sweep_test.ts','utf8');
const sweepMigration=fs.readFileSync('database/migrations/20261017150938_hd_deposit_sweep_journal_20261017100000.sql','utf8');
const sweepSqlTests=fs.readFileSync('scripts/sql-tests/hd_deposit_sweep_assertions.sql','utf8');
assert(sweepWorker.includes('const NETWORK = "TRON TESTNET"')&&sweepWorker.includes('const TOKEN = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"'),'Sweep worker must be pinned to the Shasta testnet and testnet USDT contract');
assert(sweepWorker.includes('Deno.env.get("AEGIS_ENABLE_TESTNET_SWEEP") === "true"')&&sweepWorker.includes('TESTNET_SWEEP_DISABLED'),'Testnet sweep must remain disabled unless explicitly enabled in an isolated test environment');
assert(!sweepWorker.includes('TRON_PAYOUT_PRIVATE_KEY')&&!sweepWorker.includes('TRON MAINNET'),'Sweep worker must not read Mainnet payout keys or accept a Mainnet network');
assert(sweepWorker.includes('mode.live_deposits !== false')&&sweepWorker.includes('production.payouts_locked !== true')&&sweepWorker.includes('PRODUCTION_MODE_BLOCKED'),'Sweep worker must fail closed unless all production money gates remain closed');
assert(sweepWorker.includes('UNVERIFIED_OR_AMOUNT_MISMATCHED_INBOUND_TRANSFER_PRESENT')&&sweepWorker.includes('status", "VERIFIED"'),'Sweep must not move tokens when any inbound transfer lacks a verified deposit record');
assert(sweepWorker.includes('signed_transaction: transaction.signed')&&sweepWorker.includes('sendRawTransaction(signedTx)')&&sweepWorker.includes('transaction_expiration_ms'),'Sweep must persist exact signed bytes and txid before broadcasting or retrying');
assert(sweepWorker.includes('NEEDS_TESTNET_TRX_OR_ENERGY')&&sweepWorker.includes('MIN_TRX_FOR_SWEEP_SUN'),'Sweep must skip wallets without a conservative TRX/Energy reserve rather than auto-funding from treasury');
assert(sweepHelper.includes('RECONCILE_SAVED_TRANSACTION')&&sweepHelper.includes('MANUAL_REVIEW'),'Sweep recovery must reconcile saved transaction IDs and force ambiguous cases to manual review');
assert(sweepTests.includes('sweep key is stable')&&sweepTests.includes('signed and broadcast rows reuse their saved transaction'),'Sweep tests must cover deterministic idempotency and persisted transaction recovery');
assert(sweepHelper.includes('classifySweepReceipt')&&sweepHelper.includes('hasEnoughSweepResources'),'Sweep helper must centralize on-chain receipt verification and TRX/Energy resource gates');
assert(sweepTests.includes('successful receipt requires an exact contract, recipient and raw amount')&&sweepTests.includes('resource guard requires conservative TRX or both energy and bandwidth reserve'),'Sweep unit tests must cover exact transfer confirmation and resource thresholds');
assert(sweepWorker.includes('TOKEN_BALANCE_DOES_NOT_MATCH_UNSWEPT_VERIFIED_DEPOSITS')&&sweepWorker.includes('deposit_wallet_sweep_items')&&sweepWorker.includes('UNVERIFIED_OR_AMOUNT_MISMATCHED_INBOUND_TRANSFER_PRESENT'),'Sweep must reconcile unswept verified deposit principal and fail closed on unknown transfers');
assert(sweepMigration.includes('deposit_wallet_sweep_items')&&sweepMigration.includes('SIGNED')&&sweepMigration.includes('ENABLE ROW LEVEL SECURITY')&&sweepMigration.includes('FROM PUBLIC, anon, authenticated'),'Sweep journal must store source-deposit links and signed state under service-role-only access');
assert(sweepSqlTests.includes('duplicate wallet sweep idempotency key accepted')&&sweepSqlTests.includes('duplicate sweep txid accepted')&&sweepSqlTests.includes('duplicate source deposit item accepted'),'Sweep SQL assertions must cover duplicate sweeps and source-link uniqueness');

assert(client.includes("db.functions.invoke('get-deposit-address'"),'Client must request a per-user address through the authenticated Edge Function');
assert(depositSubmitSource.includes('amountInput')&&depositSubmitSource.includes('Number.isSafeInteger(Math.round(amount * 100))'),'Deposit submission must reject excess decimal precision and unsafe numeric inputs');
assert(fs.readFileSync('.github/workflows/sql-migration-tests.yml','utf8').includes('postgres:17'),'Deposit SQL migrations must be tested on a disposable PostgreSQL service');

console.log('AegisPay canonical architecture validation: PASS');
assert(!fs.existsSync('netlify.toml'),'Obsolete Netlify production configuration must not return to canonical main');

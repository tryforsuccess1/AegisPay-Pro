# AegisPay Project Progress Handoff

Updated: 2026-10-20
Canonical repository: `tryforsuccess1/AegisPay-Pro`
Production source of truth: `main`
Supabase project: `wtcspnrmsoisroavojop`

## Current status

- Owner-reported overall development progress: approximately 92%.
- Audit distinction: this is a feature/code-completion estimate, not a measured application metric. Production/payment readiness is materially lower while real-money flows remain pre-production gated.
- Latest canonical main commit at this checkpoint: `92597d114b9cc666564dd38c85b0bd79c1c42d9b`.
- Latest main CI, Web Portal deployment, Android APK build, and Client/Master Admin release workflows passed at the time of this audit.
- AI Admin-notification policy fix is deployed to Supabase `ai-support` v38 ACTIVE. User verified: normal referral question caused no Telegram notification; unresolved deposit-status question did cause an expected Telegram notification.
- Payment safety gates remain CLOSED: `environment=PRE_PRODUCTION`, live deposits disabled, real payouts disabled, go-live approval false, payout lock true.
- Live deposit counts at audit time: `deposit_wallets=0`, `deposit_submissions=0`, `deposit_wallet_sweeps=0`. Do not instruct users to send funds.
- Supabase Security Advisor still reports native leaked-password protection disabled, nine authenticated SECURITY DEFINER warnings, three RLS-enabled service-role-only wallet tables with no client policies (intentional design; review rather than blindly adding policies), and 20 unused-index INFO findings.
- One withdrawal request is in FAILED status and must be investigated/reconciled before any payout enablement.

## Active work

Current task: **Step 2 — harden and complete the isolated TRON Shasta deposit E2E.**

- Step 1 is complete: PR #88 merged as `4db87aaeacbe699d786b6a7809b38aaa24ed4171`; its main CI, SQL/withdrawal migration tests, Android builds, portal deployment, and APK release workflows passed.
- Step 2 hardening branch: `feat/step2-shasta-deposit-e2e`.
- Draft PR #89: https://github.com/tryforsuccess1/AegisPay-Pro/pull/89
- The branch pins Shasta monitoring and user verification to the official configured testnet USDT contract, requires the recorded per-user HD wallet mapping, validates the exact six-decimal token amount without floating-point tolerance, and adds a database guard before a Shasta submission can become `VERIFIED`.
- Deno tests cover exact transfer identity and raw amounts. Disposable PostgreSQL assertions reject a non-Shasta contract and a receiver that does not match the assigned HD address.
- On code head `f3b67fa6800852cca4a09a429944c1c7077fa85b`, all workflows passed: CI, SQL migration tests, withdrawal migration tests, security foundation tests, legacy SECURITY DEFINER permission tests, manual balance-adjustment tests, and Android APK builds. The following head `d195bf5fb7fa205d8c09d2893d68e925121c40f2` changed documentation only and its full workflow set also passed; recheck the final head before merging PR #89.
- Read-only inspection of the connected Supabase project on 2026-10-20 confirmed `system_mode.mode=MAINNET`, network setting `TRON MAINNET`, live deposits false, real payouts false, go-live approval false, `PRE_PRODUCTION`, and payout lock true. Deposit wallet and sweep journal counts were zero and one withdrawal remains `FAILED`.
- The owner requested that testing and fixes remain in the **existing Supabase project**. The current implementation therefore adds a strictly separate `shasta_testnet_rules` setting and `shasta_test_users` allowlist; it must never flip global `deposit_rules` away from Mainnet.
- New code requires the `AEGIS_SHASTA_TEST_MODE=true` Edge Function secret plus an explicit enabled allowlist row. Dedicated secrets are `TRON_TESTNET_HD_WALLET_MNEMONIC`, optional `TRON_TESTNET_HD_WALLET_PASSPHRASE`, and `TRON_TESTNET_PAYOUT_PRIVATE_KEY`. The owner chose to use an existing approved app profile; its Shasta credit will raise `current_platform_balance` and `principal_balance`, while the second migration prevents testnet from changing `first_deposit_done`, `selected_tier_id`, or referral rewards. Sweep additionally requires `AEGIS_ENABLE_TESTNET_SWEEP=true` and must be invoked manually (no cron). Secret values have not been read by the assistant; address generation and the first confirmed transfer passed runtime validation.
- **First Shasta deposit E2E completed on 2026-10-20.** TXID `ad5ee7961b0a811dc60940a2d0d5162f74826060205a637dc6706b667ebc8ef1` was independently verified through confirmed-only TronGrid data: exact Shasta USDT contract, assigned HD recipient `TPXkczErK2Bo66MMU9HxYvnPFqB6mGYTTJ`, sender/treasury `TH7NgA7G17X4hm88SPL9TPptnmsSx7PbMR`, raw amount `10000000` (10.00 USDT), and block timestamp. Deposit `5adbf6e1-1c85-4968-a507-c2a5b53cab64` is `VERIFIED` / `APPROVED`, reason `CHAIN_VERIFIED_SHASTA_TRANSFER`, source `TronGrid`. Exactly one `USER_DEPOSIT` ledger entry references it for `10.00`; user balance changed from `25.36` to `35.36`, `principal_balance=10.00`, `first_deposit_done` remains false, and selected tier remains `T1`. All Mainnet flags remain closed and payout lock is enabled. Remaining Step 2 work: duplicate/retry idempotency and controlled manual sweep/recovery validation. Do not enable a production sweep cron.
- The additive database migration passed disposable PostgreSQL assertions and has now been applied to the existing Supabase project. Next: configure only dedicated Shasta test secrets and a separate treasury address, create one synthetic app account, enable that user in `shasta_test_users`, deploy the reviewed Edge Functions after preflight, and run manual Shasta E2E. Keep `deposit_rules.network=TRON MAINNET`, all live-money gates closed, payout lock enabled, sweep manual only, and no production cron schedule.

## Seven-step remaining-work plan

1. **Complete. Secure deposit UI integration.** PR #88 merged as `4db87aaeacbe699d786b6a7809b38aaa24ed4171`; main CI, browser checks, SQL/withdrawal migration tests, Android builds, portal deployment, and APK release workflows passed. Mainnet payment gates remain closed.
2. **In progress. Same-project TRON Shasta testnet deposit E2E.** PR #89 adds separate test config, a synthetic-user allowlist, dedicated test-only mnemonic/signer secrets, exact amount/contract checks and a database credit guard while global Mainnet rules remain unchanged. First fix and pass SQL/CI tests; then apply the reviewed additive migration, configure only the test key/settings/account, deploy only the reviewed deposit Edge Functions, and run a manual Shasta transfer/sweep plus ledger/history reconciliation. No Mainnet transactions, no personal/mainnet seed reuse, no production sweep cron.
3. **Finish Auth security prerequisites.** Enable native Supabase Auth Turnstile CAPTCHA after verifying updated web and Android flows; set minimum password length to 12; revisit native leaked-password protection or document approved mitigation and residual limitation; verify redirect allowlists and live sign-in/signup/reset/update flow.
4. **Investigate the existing FAILED withdrawal.** Determine the safe failure reason using non-sensitive metadata/logs, verify no funds were transferred or double-posted, reconcile status/ledger/chain records, document resolution. Keep payout gate closed until reconciled.
5. **End-to-end business workflows.** With dedicated test accounts, verify Shop task purchase/completion, rewards and referral calculations, cycle settlement, KYC submission/review, account-scoped histories, and withdrawal dual approval/reconciliation.
6. **Physical Android verification.** Install/update Client and Admin APK on a real device; verify signing continuity, SHA-256/update flow, login/reset/CAPTCHA, AI support, navigation, deposit UI, network failures, and small-screen layout.
7. **Security/readiness sign-off.** Review SECURITY DEFINER warnings per function and test authenticated role isolation; validate service-role-only wallet RLS remains inaccessible to client roles; assess Advisor findings; confirm secrets are server-side; repeat preflight and go-live readiness. Enable Mainnet only after required external configuration, test evidence, withdrawal reconciliation, and explicit business-owner approval.

## Resume instructions for a new ChatGPT conversation

Read this file first, inspect latest `main`, and recheck PR #89 plus all workflow conclusions against its current head. Resume at Step 2. Owner explicitly wants E2E work kept in the existing Supabase project, so use only `shasta_testnet_rules` plus the `shasta_test_users` allowlist; never rewrite global Mainnet settings. Do not apply migrations or deploy Edge Functions until the latest CI/migration tests pass and the exact intended changes are reviewed. Keep all real-money gates closed, payout lock on, and sweep manual/no-cron.

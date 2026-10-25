# AegisPay-Pro — Same-Project Shasta E2E Runbook

Updated: 2026-10-25 (UTC)

## Scope and safety boundary

This runbook covers isolated TRON Shasta testnet deposit verification, account-ledger reconciliation, and the controlled sweep journal. It does not authorize Mainnet deposits, real payouts, a production sweep, or any change to go-live gates.

Never place private keys, HD mnemonics, passphrases, cron secrets, or API secrets in GitHub, issue comments, logs, screenshots, or chat. The same wallet and transaction must never be credited twice.

## Confirmed Shasta test run — 2026-10-25

- Network: `TRON TESTNET` (Shasta)
- USDT test contract: `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`
- Source/child deposit wallet: `TPXkczErK2Bo66MMU9HxYvnPFqB6mGYTTJ`
- Configured test treasury: `TH7NgA7G17X4hm88SPL9TPptnmsSx7PbMR`
- Amount swept: `130.000000` testnet USDT
- Sweep journal ID: `ca2b7ed6-1123-497e-88bb-55895d88d26a`
- Sweep TXID: `96f1bb025b88fecfb911919a47e75c9adc87255f7ad6ad92766ff98658cff216`
- Confirmed block: `69538356`
- Solidified receipt: `SUCCESS`
- Recorded network fee: `1.3044 TRX`
- Sweep journal status: `CONFIRMED`, with `confirmed_at` populated and no failure code.

The on-chain transfer event matched the pinned Shasta contract, expected source, configured treasury, and raw amount `130000000`. The source wallet's post-sweep token balance was `0` USDT. The sweep journal linked four source deposits: 100, 10, 10, and 10 USDT, all already `VERIFIED`. Their raw total was `130000000`; a read-only database check found four source items, all four verified, and one journal row for the sweep TXID.

This confirmed sweep is complete. Do **not** invoke the sweep function again to repeat it. If status appears stale, reconcile the saved TXID and journal record first; never create or sign a replacement transaction automatically.

## Deposit and ledger reconciliation

Before any future Shasta test:
1. Read the current `deposit_submissions` for `TRON TESTNET`, then verify network, pinned contract, recipient, exact raw amount, canonical TXID, and confirmed block on-chain.
2. Confirm each canonical TXID is unique and each verified deposit has exactly one matching `USER_DEPOSIT` ledger entry and one appropriate audit event.
3. Historical reconciled TXID `9d4c1b2f36ae82fd1f29c78d81140994d291ba3717c97b8a2303b49d0df830eb` must never be credited again. It was reconciled to an existing manual test credit in place; no extra balance credit is permitted.
4. For screenshot-first/TXID-less tests, the screenshot/OCR is only a hint. Credit is allowed only after server-side verification identifies one unique, confirmed Shasta USDT transfer matching the assigned recipient and exact amount. Ambiguous, already-claimed, missing, or mismatched evidence must remain uncredited.
5. If a transfer has been signed or might have been broadcast, reconcile the exact saved TXID and signed bytes before any retry.

## Production settings boundary

The last verified database configuration remained:
- Environment: `PRE_PRODUCTION`
- Live deposits: `false`
- Real payouts: `false`
- Go-live approved: `false`
- Payouts locked: `true`
- System mode: `MAINNET` with live-money flags false.

These are deliberate safety controls. Do not enable Mainnet deposits, real payouts, production sweep, or go-live approval as part of Shasta testing.

The test-sweep endpoint is capable of signing/broadcasting a Shasta transfer when its configured flags, cron authentication, separate-network credentials, live-money gates, allowlist, source snapshot, and resource checks all pass. An unauthenticated request returning `401 Unauthorized` means authentication blocked that request; it does not prove the endpoint is disabled. A `423 TESTNET_SWEEP_DISABLED` response means the feature flags stopped processing. Never use unauthenticated diagnostics as proof that the configured flags are off.

## Current code and PR consolidation notes

Current `main` includes the per-deposit address allocation and the shared unique-unclaimed Shasta transfer selector. Do not merge old Shasta PRs wholesale: compare their diffs with current `main`, particularly monitor queue rotation, single-pending-wallet rules, current Client/Admin auth isolation, and live smoke tests.

Keep the existing safety checks and regression tests. Port only the missing tests/docs/CI improvements onto a branch based on current `main`. Do not rerun historical migrations that are already present in the Supabase migration history under different version IDs; reconcile migration source history before adding anything new.

## Still separate from the completed sweep

The 130-USDT sweep demonstrates a controlled, confirmed testnet transfer and journal reconciliation. It is **not** a complete runtime test of every deposit path. The screenshot-first/TXID-less deposit flow still needs a separate isolated test with a fresh inbound TXID, exact assigned wallet, exact amount, one ledger credit, an audit event, and duplicate-request handling. Do not reuse any of the four historical deposit TXIDs above.

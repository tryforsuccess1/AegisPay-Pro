# AegisPay TRON HD Deposit Wallets and Testnet Sweep

## What is implemented in this branch
- One deterministic TRON address per authenticated user and configured network using `m/44'/195'/0'/0/<index>`.
- Public address metadata only in `deposit_wallets`; no private keys or mnemonic are stored in SQL.
- Each deposit submission snapshots its assigned wallet ID, receiver and token contract.
- Verification uses the receiver stored on the deposit; legacy records without an HD mapping follow the existing controlled reconciliation path.
- The sweep worker `sweep-deposit-wallets` is hard-pinned to the Shasta testnet USDT contract. It refuses Mainnet network/token settings, requires production payment gates to be closed, and returns `TESTNET_SWEEP_DISABLED` unless `AEGIS_ENABLE_TESTNET_SWEEP=true` is explicitly set. Keep that switch unset in the production project.
- It only considers wallets whose confirmed inbound token transactions all map to `VERIFIED` deposit submissions. An unknown/unverified inbound transfer or more than 200 recent inbound transfers causes a safe skip.
- Sweep attempts are linked back to each source deposit by `deposit_wallet_sweep_items`.
- A balance snapshot uses a deterministic idempotency key. The exact signed transaction, txid and expiry are saved before network broadcast. Recovery checks the chain receipt and only re-broadcasts the same signed transaction/txid. It never silently creates a replacement after an ambiguous/expired broadcast; that case requires manual review.
- Signed transactions are temporary transfer capabilities; the sweep journal and its item table are RLS-enabled and granted only to `service_role`.

## Secrets needed for a Shasta testnet run
Configure Edge Function secrets only; never put these values in GitHub, SQL settings, browser variables or client code:
- `TRON_HD_WALLET_MNEMONIC`: a new, dedicated BIP-39 seed phrase created offline for deposit derivation.
- `TRON_HD_WALLET_PASSPHRASE`: optional BIP-39 passphrase; keep it backed up and stable if configured.
- `TRON_TESTNET_PAYOUT_PRIVATE_KEY`: the Shasta testnet treasury signer. Its derived address must exactly match `platform_settings.deposit_rules.receiving_address`.
- `TRONGRID_API_KEY`: Shasta testnet queries and rate-limit safety.
- `AEGIS_CRON_SECRET`: a strong random secret sent as `x-aegis-cron-secret` to the function. The function uses this dedicated header with JWT verification disabled.
- `AEGIS_ENABLE_TESTNET_SWEEP`: set to the exact string `true` only in an isolated test project after all other testnet secrets and fixtures are configured. Do not set it in the production project.

Do not reuse a personal seed phrase. Anyone with the mnemonic/passphrase can control every derived child address. A signed transaction stored in the sweep journal can be broadcast until expiry, so keep service-role access tightly restricted.

## Resource and retry behaviour
- The worker never sends TRX automatically from the treasury to a child address. It skips a child wallet unless it has either at least 120 TRX for conservative fee coverage or at least 100,000 available Energy plus 1 TRX for bandwidth. A testnet operator must manually provision testnet TRX/energy.
- Sweep attempts are capped at 10 wallets per invocation and each incoming-history request at 200 rows. Reaching the history cap, missing/unverified source deposits, a balance change during the snapshot, root mismatch, contract/treasury mismatch or insufficient resources results in no transfer.
- The exact signed transaction and txid are journaled before any broadcast. An uncertain broadcast is reconciled by that txid and can only re-broadcast the same signed bytes. If the saved transaction has expired without a confirmed receipt, the worker marks it for manual review instead of creating a new transaction.
- Confirmation requires a successful receipt with a matching TRC-20 Transfer event for the exact configured testnet contract, treasury and raw token amount. Failed/mismatched receipts are moved to manual review.

## Current project note
The function may exist in the shared project as a disabled endpoint, but this change does not configure the HD seed/testnet signing secret, enable the switch, add a cron schedule, or initiate an on-chain transfer. The endpoint must stay disabled in the production project.

## What remains blocked / not production-ready
- This is a testnet worker; Mainnet sweep is not implemented or enabled. No automatic cron schedule has been added.
- It does not automatically fund child addresses with TRX or delegate Energy.
- Do not enable Mainnet deposits, real payouts or go-live approval until testnet transactions, transaction-expiry/recovery, resource provisioning and accounting reconciliation have been independently reviewed. Mainnet deposits and real payouts must remain false and `payouts_locked=true`.

## Safe rollout and validation
1. Keep `environment=PRE_PRODUCTION`, `live_deposits_enabled=false`, `real_payouts_enabled=false`, `go_live_approved=false`, and `payouts_locked=true`.
2. Store the dedicated HD mnemonic/passphrase and Shasta testnet signer only in Supabase Edge Function secrets.
3. Apply the wallet and sweep-journal migrations to an isolated test database; run `hd_deposit_wallets_assertions.sql` and `hd_deposit_sweep_assertions.sql`.
4. Keep the production worker disabled (`AEGIS_ENABLE_TESTNET_SWEEP` unset) and add no cron schedule. In an isolated/test project only, enable the switch after verifying the other secret values, then test verified/unverified inbound transfers, low TRX/Energy, duplicate invocation, broadcast response loss, receipt confirmation, expired signed transactions, wrong contract and treasury mismatch.
5. Never point this worker at Mainnet. Mainnet token sweeping needs its own reviewed rollout, resource sponsorship/Energy strategy and recovery testing.

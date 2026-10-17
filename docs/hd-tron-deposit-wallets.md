# AegisPay TRON HD Deposit Wallets (Staged Rollout)

## Scope
- Each authenticated AegisPay user receives a deterministic TRON address per configured network.
- Derivation path: `m/44'/195'/0'/0/<index>`.
- SQL stores public addresses, derivation indexes and a non-secret root fingerprint only.
- New deposit records snapshot the assigned wallet and exact receiver. Automatic and direct verification use that receiver.
- Legacy deposit rows without a mapping keep the old receiver fallback for controlled reconciliation.
- Payout execution verifies that its signing key exactly matches `platform_settings.deposit_rules.receiving_address` before it claims a withdrawal.

## Required Edge Function secrets
Configure these through Supabase Edge Function Secrets only, never GitHub, SQL settings, browser variables or client code:
- `TRON_HD_WALLET_MNEMONIC`: a new, dedicated BIP-39 seed phrase created offline solely for deposit-address derivation.
- `TRON_HD_WALLET_PASSPHRASE`: optional BIP-39 passphrase; if set it must be backed up and kept stable.
- Existing `TRON_PAYOUT_PRIVATE_KEY` (Mainnet) or `TRON_TESTNET_PAYOUT_PRIVATE_KEY` (testnet) remains the treasury signer; its address must match the configured `receiving_address`.
- Existing Mainnet TronGrid, cron and Telegram secrets remain part of the readiness gate.

Do not reuse a personal wallet phrase as the HD root. Anyone with the mnemonic and passphrase can control every derived child address.

## Important limitation
This branch implements HD address assignment, per-user recipient attribution and treasury signer checks. It does **not** yet consolidate tokens from each child address into the treasury. A child-address sweep needs a separately tested Energy/TRX funding and reconciliation workflow. Until that exists, do not enable live Mainnet deposits or call this production-ready. Withdrawals pay from the configured treasury, which needs independently reconciled liquidity.

## Safe rollout
1. Keep `environment=PRE_PRODUCTION`, `live_deposits_enabled=false`, `real_payouts_enabled=false`, `go_live_approved=false`, and `payouts_locked=true`.
2. Store the separate HD mnemonic/passphrase only in Supabase Edge Function secrets.
3. Apply the migration and deploy the new Edge Function and updated deposit functions after review.
4. Test determinism, user/network isolation, simultaneous assignment, wrong recipient, duplicate TXID, root mismatch and treasury signer mismatch on testnet.
5. Implement and test sweeps, including TRX/Energy provisioning, before Mainnet enablement.

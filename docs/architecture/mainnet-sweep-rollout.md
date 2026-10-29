# Mainnet deposit-wallet consolidation rollout (LOCKED)

## Status

The `sweep-mainnet-deposit-wallets` Edge Function is being added as a separate Mainnet implementation. The deployed testnet `sweep-deposit-wallets` remains unchanged. The Mainnet function defaults to disabled because `AEGIS_ENABLE_MAINNET_SWEEP` is not enabled. Current production settings also keep live deposits and real payouts off, go-live approval off, and `payouts_locked = true`.

## Runtime prerequisites

- The Mainnet deposit HD seed and its passphrase must be present in the existing Edge Function secret store.
- The Shasta HD seed must be present and distinct from the Mainnet deposit root.
- The Mainnet treasury signer must match the server-side `deposit_rules.receiving_address`.
- TRONGrid API key and the existing Vault-backed `verify_deposit_monitor_cron_secret` authorization must work.
- `AEGIS_ENABLE_MAINNET_SWEEP=true` is a separate operator-controlled feature flag and must not be set before review.
- All configured Mainnet production gates must be open: production environment, official USDT contract, live deposits, real payouts, go-live approvals, runtime enabled, and `payouts_locked=false`.

## Sweep integrity

The function re-derives each active Mainnet deposit child and checks its address/root fingerprint. Only confirmed inbound USDT transfers matching server-verified `deposit_submissions` can be swept. It compares the child balance against all unswept, verified source transfers, writes an idempotent sweep journal plus source-item links, persists signed transaction bytes before broadcast, reconciles submitted transactions using the on-chain receipt, and sends ambiguous states to manual review.

The Mainnet treasury address and signer are read only inside the server function. Customer responses do not expose treasury configuration, wallet derivation indices, or private keys.

## Operational constraint: fees

TRC-20 transfers require native TRX or delegated Energy. This implementation intentionally fails closed if the deposit wallet lacks the required TRX/Energy reserve. It does not automatically fund Mainnet child wallets or delegate Energy. Before any real go-live, configure and test a separate fee-provisioning/recovery policy that has hard spending caps and records its own transactions. Do not test this by broadcasting Mainnet transactions.

## Withdrawal root

The withdrawal route still requires a dedicated `TRON_MAINNET_WITHDRAWAL_HD_MNEMONIC` that is independent from both deposit roots. The existing child addresses sharing the same HD root do not satisfy the isolation check. Do not remove `WITHDRAWAL_PAYOUT_HD_NOT_READY` or `WITHDRAWAL_PAYOUT_HD_ROOT_NOT_DISTINCT`.

## Verification checklist

- [ ] Mainnet sweeper is installed but returns `MAINNET_SWEEP_DISABLED` while its flag is absent/false.
- [ ] All production gates must pass again before any wallet is processed.
- [ ] Unauthorized requests are rejected by the Vault-backed cron verifier.
- [ ] Mainnet signer must match treasury configuration.
- [ ] Chain history must be complete, confirmed, source-matched, and amount-matched.
- [ ] Ambiguous TXIDs, history page caps, changing balances, journal conflicts, expired transactions, or failed/mismatched receipts stop for manual review.
- [ ] Never turn on live deposits/real payouts/go-live or unlock payouts as part of this deployment.

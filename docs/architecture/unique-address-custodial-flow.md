# AegisPay unique-address custodial flow (LOCKED)

**Decision status: LOCKED — 2026-10-29**

This is the required product workflow for deposits and withdrawals. Code and configuration changes must preserve these rules.

## Customer deposits

1. Starting a new deposit request creates a fresh `depositRequestId`.
2. `get-deposit-address` authenticates the customer, validates server-side network/readiness gates, and allocates a never-reused HD derivation index.
3. `deposit_wallets` binds that address to the authenticated AegisPay user, request ID, network and token contract. Retries/refreshes for the *same* request ID return its existing address; the client must not accidentally rotate the address mid-payment.
4. A new request after the previous request is verified/rejected uses a new request ID and a new derivation index/address. Old addresses are never reassigned.
5. Deposit submission and chain monitoring must match the assigned address, supported token contract, network, amount and confirmed transaction. Credit is applied only after server verification and must be idempotent.
6. The customer UI/API receives only the assigned deposit address, network, token contract and opaque request/wallet IDs. It must not receive the treasury address, mnemonic, private key, derivation index/path, payout journal or sweeper journal.
7. `platform_settings.deposit_rules` is a server/Admin configuration. Ordinary clients must not read it. `deposit_wallets`, `deposit_wallet_sweeps`, `withdrawal_payout_journal` and `withdrawal_payout_wallets` remain unavailable through client RLS policies.

## Treasury handling

The Mainnet treasury address and signer stay server-side. Verified funds may be moved between assigned deposit addresses and the treasury by a controlled sweep process, with idempotency, transaction receipt verification and reconciliation. **Mainnet sweeping must not be described as automatic or enabled until a Mainnet-specific sweeper exists, is reviewed, tested and separately approved.** The current deployed `sweep-deposit-wallets` function is Shasta/testnet-only and reports `mainnetSweepEnabled: false`.

The product goal is that the treasury address is never returned by customer-facing APIs or rendered in the client. Public blockchain flows may still be inspected by anyone; transaction linkability is accepted and is not a scope requirement.

## Withdrawals

1. A request is validated, balance is reserved/deducted according to existing ledger rules, and all required approvals are recorded.
2. Mainnet payout creates one unique temporary sender address per approved withdrawal from a **dedicated Mainnet withdrawal HD root**. A new payout index is assigned and never reused.
3. Server-side payout journal records activation, USDT funding, fee reserve/top-up, final payout, transaction hashes and reconciliation state. A temporary sender makes the final USDT transfer to the customer-provided destination address.
4. The treasury address is never sent to the customer or displayed in Client API/UI responses. Private keys/mnemonics remain Edge Function secrets and never enter browser code, database response rows visible to users, or logs.
5. A repeated request may not create a second on-chain payout. Ambiguous/partially submitted transactions remain in reconciliation-required state until verified.

### Required key isolation

Mainnet withdrawal sender root must be distinct from both Mainnet deposit-address root and Shasta testnet root. The four supplied HD addresses are children of one root, so changing from one child address to another does **not** meet this isolation requirement. Never bypass `WITHDRAWAL_PAYOUT_HD_NOT_READY` or `WITHDRAWAL_PAYOUT_HD_ROOT_NOT_DISTINCT`. Until a dedicated, independently generated withdrawal seed is configured and tested, real Mainnet payouts remain locked.

## Deployment and safety gates

- `PRE_PRODUCTION`, live deposits OFF, real payouts OFF, go-live approval OFF, `payouts_locked = true` remain unchanged during this work.
- Tests use Shasta/test-only allowlists and do not send real Mainnet funds.
- Do not run a Mainnet sweep or payout as a smoke test.
- User-visible network and payment readiness are taken from the authenticated Edge Function's server-issued result, not by exposing privileged `platform_settings` rows to the browser.
- Update service-worker cache version when changing `client.html`, so clients receive the privacy fixes.

## Required verification checklist

- [ ] Ordinary authenticated role cannot select `deposit_rules` from `platform_settings`.
- [ ] Master Admin can still read and configure the settings.
- [ ] Client can request an address only for its own valid session.
- [ ] Same request ID is idempotent; each new request ID gets a new, non-reused address.
- [ ] No endpoint returns treasury address, derivation index/path, mnemonic or private key to a client.
- [ ] Address-to-user/request mapping and duplicate-TXID checks remain enforced.
- [ ] A confirmed deposit credits exactly once; an unconfirmed/incorrect/duplicate transfer does not.
- [ ] Mainnet withdrawal remains blocked until an independent root is configured and all go-live approvals are independently completed.
- [ ] Mainnet sweeping remains disabled until its own implementation and review are complete.

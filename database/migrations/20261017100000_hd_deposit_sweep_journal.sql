-- Auditable, idempotency-constrained TRON HD sweep journal.
-- This migration does not enable broadcasting or Mainnet sweeps.
BEGIN;
CREATE TABLE IF NOT EXISTS public.deposit_wallet_sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_wallet_id uuid NOT NULL REFERENCES public.deposit_wallets(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('TRON TESTNET','TRON MAINNET')),
  token_contract text NOT NULL CHECK (token_contract ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  treasury_address text NOT NULL CHECK (treasury_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  txid text CHECK (txid IS NULL OR txid ~ '^[A-Fa-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'PREPARED'
    CHECK (status IN ('PREPARED','BROADCAST','CONFIRMED','FAILED_REVIEW')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Fa-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  last_checked_at timestamptz,
  failure_code text,
  CONSTRAINT deposit_wallet_sweeps_wallet_idempotency_uq UNIQUE (deposit_wallet_id, idempotency_key),
  CONSTRAINT deposit_wallet_sweeps_txid_uq UNIQUE (txid)
);
CREATE INDEX IF NOT EXISTS deposit_wallet_sweeps_pending_idx
  ON public.deposit_wallet_sweeps (created_at)
  WHERE status IN ('PREPARED','BROADCAST','FAILED_REVIEW');
ALTER TABLE public.deposit_wallet_sweeps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deposit_wallet_sweeps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.deposit_wallet_sweeps TO service_role;
COMMENT ON TABLE public.deposit_wallet_sweeps IS
  'Restricted audit journal for per-wallet TRON USDT sweep attempts. Never store mnemonics/private keys here. A broadcast attempt must be reconciled by txid before any retry.';
COMMENT ON COLUMN public.deposit_wallet_sweeps.idempotency_key IS
  'SHA-256 key for the specific wallet, network, token, and balance snapshot; unique per wallet to prevent duplicate processing of the same snapshot.';
COMMENT ON COLUMN public.deposit_wallet_sweeps.status IS
  'PREPARED means not confirmed broadcast; BROADCAST must be reconciled by txid before retry; FAILED_REVIEW blocks automatic resend.';
COMMIT;

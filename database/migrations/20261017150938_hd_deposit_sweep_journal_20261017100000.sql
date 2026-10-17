-- Restricted, idempotency-constrained TRON HD sweep journal.
-- The executable sweep worker is testnet-only. This schema alone never enables Mainnet.
BEGIN;
CREATE TABLE IF NOT EXISTS public.deposit_wallet_sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_wallet_id uuid NOT NULL REFERENCES public.deposit_wallets(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('TRON TESTNET','TRON MAINNET')),
  token_contract text NOT NULL CHECK (token_contract ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  treasury_address text NOT NULL CHECK (treasury_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  txid text CHECK (txid IS NULL OR txid ~ '^[A-Fa-f0-9]{64}$'),
  -- Persist exactly the signed transfer before any broadcast. It can spend funds until expiry.
  signed_transaction jsonb,
  transaction_expiration_ms bigint,
  status text NOT NULL DEFAULT 'PREPARED'
    CHECK (status IN ('PREPARED','SIGNED','BROADCAST','CONFIRMED','FAILED_REVIEW')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Fa-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  last_checked_at timestamptz,
  failure_code text,
  CONSTRAINT deposit_wallet_sweeps_wallet_idempotency_uq UNIQUE (deposit_wallet_id, idempotency_key),
  CONSTRAINT deposit_wallet_sweeps_txid_uq UNIQUE (txid),
  CONSTRAINT deposit_wallet_sweeps_signed_state_ck CHECK (
    status NOT IN ('SIGNED','BROADCAST','CONFIRMED')
    OR (txid IS NOT NULL AND signed_transaction IS NOT NULL AND transaction_expiration_ms IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.deposit_wallet_sweep_items (
  sweep_id uuid NOT NULL REFERENCES public.deposit_wallet_sweeps(id) ON DELETE RESTRICT,
  deposit_submission_id uuid NOT NULL REFERENCES public.deposit_submissions(id) ON DELETE RESTRICT,
  deposit_txid text NOT NULL CHECK (deposit_txid ~ '^[A-Fa-f0-9]{64}$'),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sweep_id, deposit_submission_id),
  CONSTRAINT deposit_wallet_sweep_items_sweep_txid_uq UNIQUE (sweep_id, deposit_txid)
);

CREATE INDEX IF NOT EXISTS deposit_wallet_sweep_items_submission_idx
  ON public.deposit_wallet_sweep_items (deposit_submission_id);
CREATE INDEX IF NOT EXISTS deposit_wallet_sweeps_pending_idx
  ON public.deposit_wallet_sweeps (created_at)
  WHERE status IN ('PREPARED','SIGNED','BROADCAST','FAILED_REVIEW');

ALTER TABLE public.deposit_wallet_sweeps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_wallet_sweep_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deposit_wallet_sweeps FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deposit_wallet_sweep_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.deposit_wallet_sweeps TO service_role;
GRANT SELECT, INSERT ON TABLE public.deposit_wallet_sweep_items TO service_role;

COMMENT ON TABLE public.deposit_wallet_sweeps IS
  'Restricted journal for per-wallet TRON USDT sweep attempts. Never store mnemonics/private keys here. Signed transactions are time-limited transfer capabilities and must remain service_role-only. Broadcast attempts must be reconciled by the exact persisted txid/signed bytes before any retry.';
COMMENT ON TABLE public.deposit_wallet_sweep_items IS
  'Links each sweep snapshot to the verified deposit submissions and chain transaction IDs included in that token-balance snapshot.';
COMMENT ON COLUMN public.deposit_wallet_sweeps.idempotency_key IS
  'SHA-256 key for wallet, network, token, raw balance and the sorted source transaction IDs; unique per wallet.';
COMMENT ON COLUMN public.deposit_wallet_sweeps.status IS
  'PREPARED has no signed payload; SIGNED/BROADCAST must reuse the exact stored txid and signed bytes; expired or ambiguous transactions require manual review.';
COMMIT;

ALTER TABLE public.deposit_wallet_sweeps
  ADD COLUMN IF NOT EXISTS target_deposit_txid text;

DO $$
BEGIN
  ALTER TABLE public.deposit_wallet_sweeps
    ADD CONSTRAINT deposit_wallet_sweeps_target_deposit_txid_check
    CHECK (target_deposit_txid IS NULL OR target_deposit_txid ~ '^[A-Fa-f0-9]{64}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS deposit_wallet_sweeps_wallet_target_txid_uidx
  ON public.deposit_wallet_sweeps (deposit_wallet_id, lower(target_deposit_txid))
  WHERE target_deposit_txid IS NOT NULL;

COMMENT ON COLUMN public.deposit_wallet_sweeps.target_deposit_txid IS
  'Optional exact Shasta deposit TXID selected for a targeted test sweep; NULL preserves legacy full-snapshot journal behavior.';

-- Fixed, reusable Wallet 3 for isolated Shasta withdrawal testing.
-- Mainnet payout gates are intentionally unchanged.

BEGIN;

ALTER TABLE public.withdrawal_payout_journal
  ADD COLUMN IF NOT EXISTS wallet_mode text NOT NULL DEFAULT 'EPHEMERAL_HD';

ALTER TABLE public.withdrawal_payout_journal
  DROP CONSTRAINT IF EXISTS withdrawal_payout_journal_address_key;
ALTER TABLE public.withdrawal_payout_journal
  DROP CONSTRAINT IF EXISTS withdrawal_payout_journal_derivation_index_key;
ALTER TABLE public.withdrawal_payout_journal
  DROP CONSTRAINT IF EXISTS withdrawal_payout_journal_derivation_index_check;
ALTER TABLE public.withdrawal_payout_journal
  DROP CONSTRAINT IF EXISTS withdrawal_payout_journal_wallet_mode_check;
ALTER TABLE public.withdrawal_payout_journal
  DROP CONSTRAINT IF EXISTS withdrawal_payout_journal_derivation_mode_check;

ALTER TABLE public.withdrawal_payout_journal
  ADD CONSTRAINT withdrawal_payout_journal_wallet_mode_check
  CHECK (wallet_mode IN ('EPHEMERAL_HD', 'FIXED_WALLET'));

ALTER TABLE public.withdrawal_payout_journal
  ADD CONSTRAINT withdrawal_payout_journal_derivation_mode_check
  CHECK (
    (wallet_mode = 'EPHEMERAL_HD' AND derivation_index > 0 AND derivation_index < 2147483648)
    OR
    (wallet_mode = 'FIXED_WALLET' AND derivation_index = 0)
  );

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_payout_journal_ephemeral_address_unique
  ON public.withdrawal_payout_journal (address)
  WHERE wallet_mode = 'EPHEMERAL_HD';

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_payout_journal_ephemeral_derivation_index_unique
  ON public.withdrawal_payout_journal (derivation_index)
  WHERE wallet_mode = 'EPHEMERAL_HD';

CREATE TABLE IF NOT EXISTS public.withdrawal_payout_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL CHECK (network = 'TRON TESTNET'),
  address text NOT NULL UNIQUE CHECK (address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  status text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'IN_USE', 'RECONCILIATION_REQUIRED')),
  active_withdrawal_id uuid REFERENCES public.withdrawal_requests(id) ON DELETE RESTRICT,
  lock_started_at timestamptz,
  last_released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_payout_wallets_network_unique UNIQUE (network),
  CONSTRAINT withdrawal_payout_wallets_lock_state_check CHECK (
    (status = 'AVAILABLE' AND active_withdrawal_id IS NULL AND lock_started_at IS NULL)
    OR
    (status IN ('IN_USE', 'RECONCILIATION_REQUIRED')
      AND active_withdrawal_id IS NOT NULL AND lock_started_at IS NOT NULL)
  )
);

ALTER TABLE public.withdrawal_payout_wallets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.withdrawal_payout_wallets FROM PUBLIC;
REVOKE ALL ON TABLE public.withdrawal_payout_wallets FROM anon, authenticated;
GRANT ALL ON TABLE public.withdrawal_payout_wallets TO service_role;

CREATE POLICY withdrawal_payout_wallets_deny_client_access
  ON public.withdrawal_payout_wallets
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

INSERT INTO public.withdrawal_payout_wallets (network, address, status)
VALUES ('TRON TESTNET', 'TKAJDPrY1utabzYAecHFogXiTRLkaxDdRi', 'AVAILABLE')
ON CONFLICT (network) DO NOTHING;

COMMENT ON TABLE public.withdrawal_payout_wallets IS
  'Service-role-only fixed Shasta withdrawal sender wallet lock. One configured sender address is reused across authorized test withdrawals; lock remains held when on-chain outcome needs reconciliation.';

COMMIT;

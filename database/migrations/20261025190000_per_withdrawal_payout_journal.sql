-- Per-withdrawal sender wallets: keep destination payouts separate from the reserve treasury.
-- The journal stores public addresses, state and TXIDs only. Private keys and seed phrases are never stored.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.tron_withdrawal_payout_index_seq
  AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;

CREATE TABLE IF NOT EXISTS public.withdrawal_payout_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id uuid NOT NULL UNIQUE REFERENCES public.withdrawal_requests(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  network text NOT NULL DEFAULT 'TRON MAINNET' CHECK (network IN ('TRON MAINNET','TRON TESTNET')),
  derivation_index bigint NOT NULL UNIQUE CHECK (derivation_index > 0 AND derivation_index < 2147483648),
  address text NOT NULL UNIQUE CHECK (address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  root_fingerprint text NOT NULL CHECK (root_fingerprint ~ '^[a-fA-F0-9]{64}$'),
  destination_address text NOT NULL CHECK (destination_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  net_amount_raw numeric(78,0) NOT NULL CHECK (net_amount_raw > 0),
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN (
    'PREPARED',
    'ACTIVATION_SUBMITTED',
    'ACTIVATED',
    'USDT_FUNDING_SUBMITTED',
    'USDT_FUNDED',
    'TRX_FEE_TOPUP_SUBMITTED',
    'FEE_READY',
    'PAYOUT_SUBMITTED',
    'PAID',
    'RECONCILIATION_REQUIRED',
    'FAILED_BEFORE_BROADCAST',
    'FAILED_REVIEW'
  )),
  trx_activation_txid text,
  usdt_funding_txid text,
  trx_fee_topup_txid text,
  payout_txid text,
  estimated_energy bigint CHECK (estimated_energy IS NULL OR estimated_energy >= 0),
  estimated_fee_sun numeric(30,0) CHECK (estimated_fee_sun IS NULL OR estimated_fee_sun >= 0),
  idempotency_key text NOT NULL UNIQUE,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  funded_at timestamptz,
  payout_submitted_at timestamptz,
  paid_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_payout_journal_activation_txid_unique
  ON public.withdrawal_payout_journal (trx_activation_txid)
  WHERE trx_activation_txid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_payout_journal_usdt_funding_txid_unique
  ON public.withdrawal_payout_journal (usdt_funding_txid)
  WHERE usdt_funding_txid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_payout_journal_fee_txid_unique
  ON public.withdrawal_payout_journal (trx_fee_topup_txid)
  WHERE trx_fee_topup_txid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_payout_journal_payout_txid_unique
  ON public.withdrawal_payout_journal (payout_txid)
  WHERE payout_txid IS NOT NULL;
CREATE INDEX IF NOT EXISTS withdrawal_payout_journal_status_created_idx
  ON public.withdrawal_payout_journal (status, created_at);

ALTER TABLE public.withdrawal_payout_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.withdrawal_payout_journal FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.withdrawal_payout_journal TO service_role;

DROP POLICY IF EXISTS withdrawal_payout_journal_deny_client_access ON public.withdrawal_payout_journal;
CREATE POLICY withdrawal_payout_journal_deny_client_access
  ON public.withdrawal_payout_journal FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.next_tron_withdrawal_payout_index()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT pg_catalog.nextval('public.tron_withdrawal_payout_index_seq'::regclass);
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.next_tron_withdrawal_payout_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_tron_withdrawal_payout_index() TO service_role;
REVOKE ALL PRIVILEGES ON SEQUENCE public.tron_withdrawal_payout_index_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.tron_withdrawal_payout_index_seq TO service_role;

COMMENT ON TABLE public.withdrawal_payout_journal IS
  'One-time network-specific HD sender address per approved withdrawal. Stores index, public address and funding/payout TXIDs only; never stores private keys or seed phrases.';
COMMENT ON COLUMN public.withdrawal_payout_journal.address IS
  'One-time derived payout sender address. Its public transaction history includes treasury funding and the final customer payout.';
COMMENT ON COLUMN public.withdrawal_payout_journal.status IS
  'Stage journal for idempotent funding and payout reconciliation. Any uncertain broadcast stays locked for review; never auto-retries a transfer.';
COMMENT ON FUNCTION public.next_tron_withdrawal_payout_index() IS
  'Service-role-only monotonic HD index allocator dedicated to withdrawal sender wallets; separate from deposit address allocation.';

COMMIT;

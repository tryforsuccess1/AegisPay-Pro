-- Disposable PostgreSQL fixture for service-only internal deposit/wallet table access tests.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS'; END IF;
END;
$roles$;

CREATE TABLE public.deposit_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  txid_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.deposit_wallet_sweep_items (
  sweep_id uuid NOT NULL,
  deposit_submission_id uuid NOT NULL,
  deposit_txid text NOT NULL,
  amount_raw numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(sweep_id,deposit_submission_id)
);
CREATE TABLE public.deposit_wallet_sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_wallet_id uuid NOT NULL,
  network text NOT NULL,
  token_contract text NOT NULL,
  treasury_address text NOT NULL,
  amount_raw numeric NOT NULL,
  txid text,
  signed_transaction jsonb,
  status text NOT NULL DEFAULT 'PREPARED',
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.deposit_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  network text NOT NULL,
  address text NOT NULL,
  derivation_index integer NOT NULL,
  wallet_root_fingerprint text NOT NULL,
  token_contract text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE public.shasta_test_users (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  purpose text NOT NULL DEFAULT 'Shasta E2E test account',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deposit_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_wallet_sweep_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_wallet_sweeps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shasta_test_users ENABLE ROW LEVEL SECURITY;

-- Simulate accidental broad grants so the migration must actively revoke them.
GRANT ALL PRIVILEGES ON TABLE
  public.deposit_security_events,
  public.deposit_wallet_sweep_items,
  public.deposit_wallet_sweeps,
  public.deposit_wallets,
  public.shasta_test_users
TO PUBLIC, anon, authenticated, service_role;

-- Per-user TRON HD deposit-address foundation. Keys are never stored in SQL.
BEGIN;
CREATE SEQUENCE IF NOT EXISTS public.tron_deposit_address_index_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO CYCLE;
CREATE TABLE IF NOT EXISTS public.deposit_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('TRON MAINNET','TRON TESTNET')),
  address text NOT NULL CHECK (address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  derivation_index integer NOT NULL CHECK (derivation_index >= 1 AND derivation_index < 2147483648),
  wallet_root_fingerprint text NOT NULL CHECK (wallet_root_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
  token_contract text NOT NULL CHECK (token_contract ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  CONSTRAINT deposit_wallets_user_network_uq UNIQUE (user_id, network),
  CONSTRAINT deposit_wallets_network_address_uq UNIQUE (network, address),
  CONSTRAINT deposit_wallets_network_index_uq UNIQUE (network, derivation_index)
);
ALTER TABLE public.deposit_submissions
  ADD COLUMN IF NOT EXISTS deposit_wallet_id uuid REFERENCES public.deposit_wallets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS receiving_address text;
CREATE INDEX IF NOT EXISTS deposit_submissions_wallet_idx ON public.deposit_submissions (deposit_wallet_id) WHERE deposit_wallet_id IS NOT NULL;
COMMENT ON TABLE public.deposit_wallets IS 'Per-user TRON HD deposit-address mapping; public address metadata only, never seed phrases/private keys.';
COMMENT ON COLUMN public.deposit_wallets.wallet_root_fingerprint IS 'SHA-256 fingerprint of HD root address index 0 to detect an unexpected root-secret change.';
COMMENT ON COLUMN public.deposit_submissions.receiving_address IS 'Expected recipient snapshot for this deposit. Legacy rows may be NULL for controlled reconciliation.';
ALTER TABLE public.deposit_wallets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deposit_wallets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deposit_wallets TO service_role;
REVOKE ALL ON SEQUENCE public.tron_deposit_address_index_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.tron_deposit_address_index_seq TO service_role;
CREATE OR REPLACE FUNCTION public.next_tron_deposit_address_index()
RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT nextval('public.tron_deposit_address_index_seq'::regclass); $function$;
REVOKE ALL ON FUNCTION public.next_tron_deposit_address_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_tron_deposit_address_index() TO service_role;
COMMIT;

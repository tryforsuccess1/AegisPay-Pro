-- Per-deposit TRON HD addresses. Preserve all historical addresses and their deposit links.
BEGIN;

ALTER TABLE public.deposit_wallets
  ADD COLUMN IF NOT EXISTS deposit_request_id uuid;

ALTER TABLE public.deposit_wallets
  ADD COLUMN IF NOT EXISTS last_sweep_attempt_at timestamptz;

-- Backfill existing wallet rows with stable request IDs so the column can be enforced safely.
UPDATE public.deposit_wallets SET deposit_request_id = gen_random_uuid() WHERE deposit_request_id IS NULL;
ALTER TABLE public.deposit_wallets ALTER COLUMN deposit_request_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.deposit_wallets ALTER COLUMN deposit_request_id SET NOT NULL;

ALTER TABLE public.deposit_wallets DROP CONSTRAINT IF EXISTS deposit_wallets_user_network_uq;
CREATE UNIQUE INDEX IF NOT EXISTS deposit_wallets_request_id_uq
  ON public.deposit_wallets (user_id, network, deposit_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS deposit_wallets_network_address_uq
  ON public.deposit_wallets (network, address);
CREATE UNIQUE INDEX IF NOT EXISTS deposit_wallets_network_index_uq
  ON public.deposit_wallets (network, derivation_index);
CREATE INDEX IF NOT EXISTS deposit_wallets_user_network_created_idx
  ON public.deposit_wallets (user_id, network, created_at DESC);
CREATE INDEX IF NOT EXISTS deposit_wallets_sweep_rotation_idx
  ON public.deposit_wallets (network, token_contract, status, last_sweep_attempt_at, created_at);
COMMENT ON COLUMN public.deposit_wallets.deposit_request_id IS
  'Client-generated idempotency key for one deposit-page request; the same key reuses the same address on retries, a new request gets a fresh HD address.';

-- Serialize address issuance per user/network and limit repeated address generation.
CREATE OR REPLACE FUNCTION public.enforce_tron_deposit_wallet_issue_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE recent_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || NEW.network::text, 0));
  SELECT count(*) INTO recent_count FROM public.deposit_wallets
    WHERE user_id = NEW.user_id AND network = NEW.network
      AND created_at >= now() - interval '24 hours';
  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'DEPOSIT_ADDRESS_RATE_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS deposit_wallets_issue_limit_trg ON public.deposit_wallets;
CREATE TRIGGER deposit_wallets_issue_limit_trg
BEFORE INSERT ON public.deposit_wallets
FOR EACH ROW EXECUTE FUNCTION public.enforce_tron_deposit_wallet_issue_limit();

COMMIT;

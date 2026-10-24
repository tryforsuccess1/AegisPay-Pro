-- Per-deposit TRON HD addresses. Preserve all historical addresses and their deposit links.
BEGIN;

ALTER TABLE public.deposit_wallets
  ADD COLUMN IF NOT EXISTS deposit_request_id uuid;

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
COMMENT ON COLUMN public.deposit_wallets.deposit_request_id IS
  'Client-generated idempotency key for one deposit-page request; the same key reuses the same address on retries, a new request gets a fresh HD address.';

COMMIT;

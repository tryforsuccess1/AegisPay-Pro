-- Independent database boundary for verified Shasta deposits.
-- This migration does not enable live deposits, payouts, cron, or testnet sweeping.
BEGIN;

-- A narrowly scoped row-level allowlist lets one synthetic account use Shasta
-- in this project without changing the live deposit_rules network.
CREATE TABLE IF NOT EXISTS public.shasta_test_users (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  purpose text NOT NULL DEFAULT 'Shasta E2E test account',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shasta_test_users ENABLE ROW LEVEL SECURITY;
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.shasta_test_users FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.shasta_test_users FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shasta_test_users TO service_role';
  END IF;
END;
$roles$;
REVOKE ALL ON TABLE public.shasta_test_users FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.guard_shasta_deposit_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_rules jsonb := '{}'::jsonb;
  v_wallet public.deposit_wallets%ROWTYPE;
  v_raw text := btrim(COALESCE(NEW.raw_amount, ''));
BEGIN
  IF upper(btrim(COALESCE(NEW.status, ''))) <> 'VERIFIED'
     OR upper(btrim(COALESCE(NEW.network, ''))) <> 'TRON TESTNET' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(value_json, '{}'::jsonb)
    INTO v_rules
    FROM public.platform_settings
   WHERE key = 'shasta_testnet_rules';

  IF NOT EXISTS (
       SELECT 1 FROM public.shasta_test_users t
        WHERE t.user_id = NEW.user_id AND t.enabled = true
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Shasta deposit credit is restricted to the explicitly allowlisted test account';
  END IF;

  IF upper(btrim(COALESCE(v_rules ->> 'network', ''))) <> 'TRON TESTNET'
     OR btrim(COALESCE(v_rules ->> 'token_contract', '')) <> 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs'
     OR btrim(COALESCE(NEW.token_contract, '')) <> 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Shasta deposit credit requires the pinned Shasta USDT contract and network';
  END IF;

  IF NEW.deposit_wallet_id IS NULL
     OR btrim(COALESCE(NEW.receiving_address, '')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
     OR btrim(COALESCE(NEW.txid, '')) !~ '^[A-Fa-f0-9]{64}$'
     OR btrim(COALESCE(NEW.sender_address, '')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
     OR NEW.block_timestamp IS NULL
     OR btrim(COALESCE(NEW.verification_source, '')) = ''
     OR COALESCE(NEW.ai_review_status, '') NOT IN ('APPROVED', 'MANUAL_APPROVED') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Shasta deposit credit is missing verified chain or review evidence';
  END IF;

  IF v_raw !~ '^[1-9][0-9]*$' OR length(v_raw) > 78
     OR NEW.gross_amount IS NULL OR NEW.gross_amount <= 0
     OR NEW.deposit_fee IS NULL OR NEW.deposit_fee < 0
     OR NEW.deposit_fee > NEW.gross_amount
     OR v_raw::numeric / 1000000 <> NEW.gross_amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Shasta raw token amount does not exactly match the deposit request';
  END IF;

  SELECT * INTO v_wallet
    FROM public.deposit_wallets
   WHERE id = NEW.deposit_wallet_id
     AND user_id = NEW.user_id;

  IF NOT FOUND
     OR upper(btrim(COALESCE(v_wallet.network, ''))) <> 'TRON TESTNET'
     OR v_wallet.address IS DISTINCT FROM btrim(NEW.receiving_address)
     OR v_wallet.token_contract IS DISTINCT FROM 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Shasta deposit must match the receiving address assigned to this user';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_shasta_deposit_verification ON public.deposit_submissions;
CREATE TRIGGER guard_shasta_deposit_verification
BEFORE INSERT OR UPDATE ON public.deposit_submissions
FOR EACH ROW
EXECUTE FUNCTION public.guard_shasta_deposit_verification();

REVOKE ALL ON FUNCTION public.guard_shasta_deposit_verification() FROM PUBLIC;

COMMIT;

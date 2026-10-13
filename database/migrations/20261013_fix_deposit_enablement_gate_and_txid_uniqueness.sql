-- Fix the independent deposit-enable gate and prevent one chain transaction
-- from being credited through more than one deposit submission.
-- Source-only migration: validate and test in an isolated database before production rollout.

BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.deposit_submissions
    WHERE txid IS NOT NULL
      AND btrim(txid) <> ''
      AND network IS NOT NULL
      AND btrim(network) <> ''
    GROUP BY lower(btrim(network)), lower(btrim(txid))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate deposit network/transaction references already exist; manual reconciliation is required before adding the unique index';
  END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS deposit_submissions_network_txid_uq
  ON public.deposit_submissions (lower(btrim(network)), lower(btrim(txid)))
  WHERE txid IS NOT NULL
    AND btrim(txid) <> ''
    AND network IS NOT NULL
    AND btrim(network) <> '';

CREATE OR REPLACE FUNCTION public.apply_verified_deposit(
  p_deposit_id UUID,
  p_sender_address TEXT,
  p_raw_amount TEXT,
  p_block_timestamp TIMESTAMPTZ,
  p_verification_source TEXT DEFAULT 'TronGrid'
)
RETURNS public.deposit_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  d public.deposit_submissions;
  u public.users;
  t public.vip_tiers;
  parent_user public.users;
  r public.users;
  credited NUMERIC(18,2);
  v_rules JSONB := '{}'::jsonb;
  v_mode JSONB := '{}'::jsonb;
  v_network TEXT;
  v_contract TEXT;
BEGIN
  IF p_deposit_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A deposit reference is required';
  END IF;
  IF COALESCE(btrim(p_sender_address),'') = ''
     OR COALESCE(btrim(p_raw_amount),'') !~ '^[0-9]+$'
     OR p_block_timestamp IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Verified chain transfer evidence is incomplete';
  END IF;

  SELECT * INTO d
  FROM public.deposit_submissions
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;

  -- Idempotency: never apply a second credit or repeat referral effects.
  IF d.status <> 'PENDING_VERIFICATION' THEN
    RETURN d;
  END IF;

  IF d.ai_review_status NOT IN ('APPROVED','MANUAL_APPROVED') THEN
    RAISE EXCEPTION 'Deposit evidence must be approved before credit';
  END IF;
  IF COALESCE(btrim(d.txid),'') = '' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A transaction ID is required before deposit credit';
  END IF;
  IF d.gross_amount IS NULL OR d.gross_amount <= 0
     OR d.deposit_fee IS NULL OR d.deposit_fee < 0
     OR d.deposit_fee > d.gross_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit amount or fee is invalid';
  END IF;

  SELECT COALESCE(value_json,'{}'::jsonb) INTO v_rules
  FROM public.platform_settings WHERE key = 'deposit_rules';
  v_network := upper(btrim(COALESCE(v_rules ->> 'network','')));
  v_contract := btrim(COALESCE(v_rules ->> 'token_contract',''));

  IF v_network = 'TRON TESTNET' THEN
    v_contract := COALESCE(NULLIF(v_contract,''),'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs');
  ELSIF v_network = 'TRON MAINNET' THEN
    SELECT COALESCE(value_json,'{}'::jsonb) INTO v_mode
    FROM public.platform_settings WHERE key = 'system_mode';

    -- Deposits are controlled by live_deposits. real_payouts is a separate
    -- withdrawal switch and must not prevent credit for a confirmed deposit.
    IF COALESCE(v_mode ->> 'mode','') <> 'MAINNET'
       OR COALESCE((v_mode ->> 'live_deposits')::BOOLEAN,FALSE) IS NOT TRUE THEN
      RAISE EXCEPTION 'Mainnet deposit crediting is disabled by the live-deposit gate';
    END IF;
    v_contract := COALESCE(NULLIF(v_contract,''),'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  ELSE
    RAISE EXCEPTION 'Unsupported TRON deposit network';
  END IF;

  SELECT * INTO u FROM public.users WHERE id = d.user_id FOR UPDATE;
  SELECT * INTO t FROM public.vip_tiers WHERE id = d.tier_id;
  IF u.id IS NULL OR t.id IS NULL THEN
    RAISE EXCEPTION 'User or tier not found';
  END IF;
  credited := d.gross_amount - d.deposit_fee;

  -- Updating network under the unique index makes a reused transaction ID fail
  -- closed before balance, ledger, referral, or task-cycle effects can persist.
  UPDATE public.deposit_submissions SET
    status = 'VERIFIED',
    verified_at = NOW(),
    verification_note = 'Verified against confirmed TRON TRC20 transfer.',
    network = v_network,
    token_contract = v_contract,
    raw_amount = p_raw_amount,
    sender_address = btrim(p_sender_address),
    block_timestamp = p_block_timestamp,
    verification_source = p_verification_source
  WHERE id = d.id
    AND status = 'PENDING_VERIFICATION'
  RETURNING * INTO d;

  IF d.id IS NULL OR d.status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Deposit state changed before credit could be recorded';
  END IF;

  UPDATE public.users SET
    current_platform_balance = COALESCE(current_platform_balance,0) + credited,
    principal_balance = COALESCE(principal_balance,0) + credited,
    first_deposit_done = TRUE,
    selected_tier_id = t.id
  WHERE id = u.id;

  INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id,metadata)
  VALUES(
    u.id,'USER_DEPOSIT',credited,'Verified TRON USDT deposit credit',d.id::TEXT,
    jsonb_build_object(
      'gross',d.gross_amount,'fee',d.deposit_fee,'txid',d.txid,'tier',t.name,
      'network',v_network,'token_contract',v_contract
    )
  );
  INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
  VALUES(NULL,u.id,'DEPOSIT_VERIFIED','Deposit verified from confirmed TRON transfer',d.id::TEXT);

  SELECT * INTO parent_user FROM public.users WHERE id = u.referred_by FOR UPDATE;
  IF parent_user.id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.referrals
      WHERE user_id=parent_user.id AND referred_user_id=u.id AND referral_level=1
    ) THEN
      UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+5,
          profit_balance=COALESCE(profit_balance,0)+5
      WHERE id=parent_user.id;
      INSERT INTO public.referrals(user_id,referred_user_id,referral_level,platform_reward,created_at)
      VALUES(parent_user.id,u.id,1,5,NOW());
      INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id)
      VALUES(parent_user.id,'REFERRAL_L1',5,'Direct referral first verified deposit bonus',d.id::TEXT);
    END IF;

    SELECT * INTO r FROM public.users WHERE id=parent_user.referred_by FOR UPDATE;
    IF r.id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.referrals
      WHERE user_id=r.id AND referred_user_id=u.id AND referral_level=2
    ) THEN
      UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+2,
          profit_balance=COALESCE(profit_balance,0)+2
      WHERE id=r.id;
      INSERT INTO public.referrals(user_id,referred_user_id,referral_level,platform_reward,created_at)
      VALUES(r.id,u.id,2,2,NOW());
      INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id)
      VALUES(r.id,'REFERRAL_L2',2,'Second-level referral first verified deposit bonus',d.id::TEXT);
    END IF;
  END IF;

  RETURN d;
END;
$function$;

COMMENT ON FUNCTION public.apply_verified_deposit(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT)
IS 'Service-role verified deposit credit; uses the independent live-deposit gate, fixed search path, locked/idempotent state transition, and unique network transaction reference.';

COMMIT;

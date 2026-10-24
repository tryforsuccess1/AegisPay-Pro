-- Reconcile the repository with the live network-specific deposit credit gate and prevent
-- concurrent submissions from binding multiple pending deposits to one receiving wallet.
BEGIN;

CREATE OR REPLACE FUNCTION public.apply_verified_deposit(p_deposit_id uuid, p_sender_address text, p_raw_amount text, p_block_timestamp timestamp with time zone, p_verification_source text DEFAULT 'TronGrid'::text)
 RETURNS deposit_submissions
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
  v_production JSONB := '{}'::jsonb;
  v_mainnet_rules JSONB := '{}'::jsonb;
  v_ref_rules JSONB := '{}'::jsonb;
  v_network TEXT;
  v_contract TEXT;
  v_l1 NUMERIC(18,2);
  v_l2 NUMERIC(18,2);
  v_chain_amount NUMERIC;
BEGIN
  IF p_deposit_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A deposit reference is required';
  END IF;
  IF COALESCE(btrim(p_sender_address),'') !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
     OR COALESCE(btrim(p_raw_amount),'') !~ '^[1-9][0-9]*$'
     OR p_block_timestamp IS NULL
     OR COALESCE(btrim(p_verification_source),'') = '' THEN
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
  IF d.status IS DISTINCT FROM 'PENDING_VERIFICATION' THEN
    RETURN d;
  END IF;

  IF COALESCE(d.ai_review_status,'') NOT IN ('APPROVED','MANUAL_APPROVED') THEN
    RAISE EXCEPTION 'Deposit evidence must be approved before credit';
  END IF;
  IF length(COALESCE(btrim(d.txid),'')) <> 64
     OR COALESCE(btrim(d.txid),'') !~ '^[A-Fa-f0-9]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A valid 64-character chain transaction ID is required before deposit credit';
  END IF;
  IF d.gross_amount IS NULL OR d.gross_amount <= 0
     OR d.deposit_fee IS NULL OR d.deposit_fee < 0
     OR d.deposit_fee > d.gross_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit amount or fee is invalid';
  END IF;

  -- Both supported USDT TRC-20 contracts use six decimal places. Validate the
  -- raw confirmed transfer amount again inside the database boundary.
  v_chain_amount := p_raw_amount::numeric / 1000000;
  IF v_chain_amount <> d.gross_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='On-chain raw amount does not match the submitted deposit amount';
  END IF;

  -- Shasta is a separate, explicitly allowlisted test path. Global Mainnet rules
  -- remain untouched, even while a designated test account uses the test network.
  IF upper(btrim(COALESCE(d.network,''))) = 'TRON TESTNET' THEN
    SELECT COALESCE(value_json,'{}'::jsonb) INTO v_rules
      FROM public.platform_settings WHERE key = 'shasta_testnet_rules';
    v_network := upper(btrim(COALESCE(v_rules ->> 'network','')));
    v_contract := btrim(COALESCE(v_rules ->> 'token_contract',''));

    IF v_network <> 'TRON TESTNET'
       OR v_contract <> 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Shasta requires the separate pinned testnet configuration';
    END IF;

    SELECT COALESCE(value_json,'{}'::jsonb) INTO v_mainnet_rules
      FROM public.platform_settings WHERE key = 'deposit_rules';
    IF upper(btrim(COALESCE(v_mainnet_rules ->> 'network',''))) <> 'TRON MAINNET'
       OR btrim(COALESCE(v_mainnet_rules ->> 'token_contract','')) <> 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
       OR btrim(COALESCE(v_mainnet_rules ->> 'receiving_address','')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
       OR btrim(COALESCE(v_mainnet_rules ->> 'receiving_address','')) = btrim(COALESCE(v_rules ->> 'receiving_address','')) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Shasta test treasury must be distinct from a valid Mainnet treasury';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.shasta_test_users test_user
       WHERE test_user.user_id = d.user_id AND test_user.enabled = true
    ) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Shasta deposit credit is restricted to the allowlisted test account';
    END IF;

    SELECT COALESCE(value_json,'{}'::jsonb) INTO v_mode
      FROM public.platform_settings WHERE key = 'system_mode';
    SELECT COALESCE(value_json,'{}'::jsonb) INTO v_production
      FROM public.platform_settings WHERE key = 'production_config';
    IF COALESCE(v_mode ->> 'mode','') <> 'MAINNET'
       OR COALESCE(v_mode ->> 'live_deposits','true') <> 'false'
       OR COALESCE(v_mode ->> 'real_payouts','true') <> 'false'
       OR COALESCE(v_mode ->> 'production_go_live_approved','true') <> 'false'
       OR COALESCE(v_production ->> 'environment','') <> 'PRE_PRODUCTION'
       OR COALESCE(v_production ->> 'live_deposits_enabled','true') <> 'false'
       OR COALESCE(v_production ->> 'real_payouts_enabled','true') <> 'false'
       OR COALESCE(v_production ->> 'go_live_approved','true') <> 'false'
       OR COALESCE(v_production ->> 'payouts_locked','false') <> 'true' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Shasta test credits require all live-money gates to remain closed';
    END IF;
  ELSE
    SELECT COALESCE(value_json,'{}'::jsonb) INTO v_rules
      FROM public.platform_settings WHERE key = 'deposit_rules';
    v_network := upper(btrim(COALESCE(v_rules ->> 'network','')));
    v_contract := btrim(COALESCE(v_rules ->> 'token_contract',''));

    -- The configured chain may not be changed underneath a submitted transaction.
    IF NULLIF(btrim(d.network),'') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit submission has no recorded network; manual reconciliation is required';
    END IF;
    IF upper(btrim(d.network)) <> v_network THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit network differs from current settings; manual reconciliation is required';
    END IF;
  END IF;

  IF v_network = 'TRON TESTNET' THEN
    IF v_contract <> 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Configured Shasta token contract must be the pinned test USDT contract';
    END IF;
  ELSIF v_network = 'TRON MAINNET' THEN
    SELECT COALESCE(value_json,'{}'::jsonb) INTO v_mode
    FROM public.platform_settings WHERE key = 'system_mode';

    -- Deposits are controlled by live_deposits. Production-readiness controls
    -- separately ensure this flag cannot be enabled while payout readiness is unsafe.
    IF COALESCE(v_mode ->> 'mode','') <> 'MAINNET'
       OR COALESCE((v_mode ->> 'live_deposits')::BOOLEAN,FALSE) IS NOT TRUE THEN
      RAISE EXCEPTION 'Mainnet deposit crediting is disabled by the live-deposit gate';
    END IF;
    v_contract := COALESCE(NULLIF(v_contract,''),'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    IF v_contract <> 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Configured TRON Mainnet token contract must be the official USDT contract';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported TRON deposit network';
  END IF;

  SELECT * INTO u FROM public.users WHERE id = d.user_id FOR UPDATE;
  SELECT * INTO t FROM public.vip_tiers WHERE id = d.tier_id;
  IF u.id IS NULL OR t.id IS NULL THEN
    RAISE EXCEPTION 'User or tier not found';
  END IF;
  credited := d.gross_amount - d.deposit_fee;

  -- The unique index protects the network/txid pair before any financial side effect.
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

  IF v_network = 'TRON TESTNET' THEN
    -- Testnet must never consume the account's Mainnet first-deposit entitlement
    -- or change its production tier. It only records a clearly tagged test credit.
    UPDATE public.users SET
      current_platform_balance = COALESCE(current_platform_balance,0) + credited,
      principal_balance = COALESCE(principal_balance,0) + credited
    WHERE id = u.id;
  ELSE
    UPDATE public.users SET
      current_platform_balance = COALESCE(current_platform_balance,0) + credited,
      principal_balance = COALESCE(principal_balance,0) + credited,
      first_deposit_done = TRUE,
      selected_tier_id = t.id
    WHERE id = u.id;
  END IF;

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

  -- Testnet credits never trigger production referral rewards.
  IF v_network = 'TRON MAINNET' THEN
  -- Keep referral rewards configurable; do not hard-code amounts into a later function replacement.
  SELECT COALESCE(value_json,'{}'::jsonb) INTO v_ref_rules
  FROM public.platform_settings WHERE key = 'referral_rules';
  v_l1 := GREATEST(0, COALESCE((v_ref_rules->>'level_1')::NUMERIC,5));
  v_l2 := GREATEST(0, COALESCE((v_ref_rules->>'level_2')::NUMERIC,2));

  SELECT * INTO parent_user FROM public.users WHERE id = u.referred_by FOR UPDATE;
  IF parent_user.id IS NOT NULL THEN
    IF v_l1 > 0 AND NOT EXISTS (
      SELECT 1 FROM public.referrals
      WHERE user_id=parent_user.id AND referred_user_id=u.id AND referral_level=1
    ) THEN
      UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+v_l1,
          profit_balance=COALESCE(profit_balance,0)+v_l1
      WHERE id=parent_user.id;
      INSERT INTO public.referrals(user_id,referred_user_id,referral_level,platform_reward,created_at)
      VALUES(parent_user.id,u.id,1,v_l1,NOW());
      INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id)
      VALUES(parent_user.id,'REFERRAL_L1',v_l1,'Direct referral first verified deposit bonus',d.id::TEXT);
    END IF;

    SELECT * INTO r FROM public.users WHERE id=parent_user.referred_by FOR UPDATE;
    IF r.id IS NOT NULL AND v_l2 > 0 AND NOT EXISTS (
      SELECT 1 FROM public.referrals
      WHERE user_id=r.id AND referred_user_id=u.id AND referral_level=2
    ) THEN
      UPDATE public.users
      SET current_platform_balance=COALESCE(current_platform_balance,0)+v_l2,
          profit_balance=COALESCE(profit_balance,0)+v_l2
      WHERE id=r.id;
      INSERT INTO public.referrals(user_id,referred_user_id,referral_level,platform_reward,created_at)
      VALUES(r.id,u.id,2,v_l2,NOW());
      INSERT INTO public.account_ledger(user_id,entry_type,amount,description,reference_id)
      VALUES(r.id,'REFERRAL_L2',v_l2,'Second-level referral first verified deposit bonus',d.id::TEXT);
    END IF;
  END IF; -- parent referral exists
  END IF; -- Mainnet-only referral rewards

  RETURN d;
END;
$function$
;

CREATE UNIQUE INDEX IF NOT EXISTS deposit_submissions_one_pending_per_wallet_uq
  ON public.deposit_submissions (deposit_wallet_id)
  WHERE deposit_wallet_id IS NOT NULL AND status = 'PENDING_VERIFICATION';

COMMIT;

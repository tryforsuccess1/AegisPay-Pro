-- Master-Admin one-click approval for allowlisted Shasta TESTNET deposits.
-- This is a test-only manual credit path. Mainnet always requires confirmed TXID verification.
BEGIN;

CREATE OR REPLACE FUNCTION public.apply_manual_testnet_deposit_approval(
  p_deposit_id uuid,
  p_actor_user_id uuid
)
RETURNS public.deposit_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  d public.deposit_submissions;
  v_actor public.users;
  v_user public.users;
  v_wallet public.deposit_wallets;
  v_tier public.vip_tiers;
  v_shasta_rules jsonb := '{}'::jsonb;
  v_mainnet_rules jsonb := '{}'::jsonb;
  v_mode jsonb := '{}'::jsonb;
  v_production jsonb := '{}'::jsonb;
  v_credit numeric(18,2);
  v_contract text := 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs';
BEGIN
  IF p_deposit_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit and Master Admin references are required';
  END IF;

  SELECT * INTO v_actor
  FROM public.users
  WHERE id = p_actor_user_id
  FOR SHARE;

  IF v_actor.id IS NULL
     OR upper(btrim(COALESCE(v_actor.role,''))) <> 'MASTER ADMIN'
     OR upper(btrim(COALESCE(v_actor.status,''))) IN ('BLOCKED','SUSPENDED','DELETED') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active Master Admin approval is required';
  END IF;

  SELECT * INTO d
  FROM public.deposit_submissions
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;

  -- Repeated approval is idempotent: never add a second ledger credit.
  IF d.status = 'VERIFIED' AND d.verification_source = 'MASTER_ADMIN_TESTNET_MANUAL' THEN
    RETURN d;
  END IF;
  IF d.status IS DISTINCT FROM 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'Deposit is no longer awaiting review';
  END IF;

  IF upper(btrim(COALESCE(d.network,''))) <> 'TRON TESTNET' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Manual approval without a TXID is restricted to TRON TESTNET';
  END IF;
  IF NULLIF(btrim(COALESCE(d.txid,'')),'') IS NOT NULL
     OR NULLIF(btrim(COALESCE(d.submitted_txid,'')),'') IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A submitted transaction ID must use the normal on-chain verifier';
  END IF;
  IF NULLIF(btrim(COALESCE(d.screenshot_path,'')),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit evidence is required before manual approval';
  END IF;
  IF d.deposit_wallet_id IS NULL
     OR d.gross_amount IS NULL OR d.gross_amount <= 0
     OR d.deposit_fee IS NULL OR d.deposit_fee < 0
     OR d.deposit_fee > d.gross_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit wallet, amount or fee is invalid';
  END IF;

  SELECT * INTO v_wallet
  FROM public.deposit_wallets
  WHERE id = d.deposit_wallet_id
    AND user_id = d.user_id
  FOR SHARE;

  IF v_wallet.id IS NULL
     OR v_wallet.status <> 'ACTIVE'
     OR v_wallet.network <> 'TRON TESTNET'
     OR v_wallet.address IS DISTINCT FROM d.receiving_address
     OR v_wallet.token_contract <> v_contract
     OR COALESCE(d.token_contract,'') <> v_contract THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit does not match the user active Shasta test wallet';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = d.user_id
  FOR UPDATE;

  IF v_user.id IS NULL
     OR upper(btrim(COALESCE(v_user.role,''))) <> 'USER'
     OR upper(btrim(COALESCE(v_user.status,''))) IN ('BLOCKED','SUSPENDED','DELETED') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit owner is not eligible for a test credit';
  END IF;

  SELECT * INTO v_tier
  FROM public.vip_tiers
  WHERE id = d.tier_id;

  IF v_tier.id IS NULL THEN
    RAISE EXCEPTION 'Deposit tier not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shasta_test_users test_user
    WHERE test_user.user_id = d.user_id AND test_user.enabled = true
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Shasta test credits are restricted to the allowlisted test account';
  END IF;

  SELECT COALESCE((SELECT value_json FROM public.platform_settings WHERE key='shasta_testnet_rules'),'{}'::jsonb)
    INTO v_shasta_rules;
  SELECT COALESCE((SELECT value_json FROM public.platform_settings WHERE key='deposit_rules'),'{}'::jsonb)
    INTO v_mainnet_rules;
  SELECT COALESCE((SELECT value_json FROM public.platform_settings WHERE key='system_mode'),'{}'::jsonb)
    INTO v_mode;
  SELECT COALESCE((SELECT value_json FROM public.platform_settings WHERE key='production_config'),'{}'::jsonb)
    INTO v_production;

  IF upper(btrim(COALESCE(v_shasta_rules->>'network',''))) <> 'TRON TESTNET'
     OR btrim(COALESCE(v_shasta_rules->>'token_contract','')) <> v_contract THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Shasta requires the pinned testnet configuration';
  END IF;

  IF upper(btrim(COALESCE(v_mainnet_rules->>'network',''))) <> 'TRON MAINNET'
     OR btrim(COALESCE(v_mainnet_rules->>'token_contract','')) <> 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
     OR btrim(COALESCE(v_mainnet_rules->>'receiving_address','')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
     OR btrim(COALESCE(v_shasta_rules->>'receiving_address','')) !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
     OR btrim(COALESCE(v_mainnet_rules->>'receiving_address','')) = btrim(COALESCE(v_shasta_rules->>'receiving_address','')) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Shasta treasury must remain separate from the official Mainnet USDT treasury';
  END IF;

  -- Manual test credit is allowed only while every live-money gate stays closed.
  IF upper(COALESCE(v_mode->>'mode','')) <> 'MAINNET'
     OR COALESCE(v_mode->>'live_deposits','true') <> 'false'
     OR COALESCE(v_mode->>'real_payouts','true') <> 'false'
     OR COALESCE(v_mode->>'production_go_live_approved','true') <> 'false'
     OR upper(COALESCE(v_production->>'environment','')) <> 'PRE_PRODUCTION'
     OR COALESCE(v_production->>'live_deposits_enabled','true') <> 'false'
     OR COALESCE(v_production->>'real_payouts_enabled','true') <> 'false'
     OR COALESCE(v_production->>'go_live_approved','true') <> 'false'
     OR COALESCE(v_production->>'payouts_locked','false') <> 'true' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Manual test credits require all live-money gates to remain closed';
  END IF;

  v_credit := round(d.gross_amount - d.deposit_fee, 2);

  UPDATE public.deposit_submissions
  SET status = 'VERIFIED',
      credited_amount = v_credit,
      ai_review_status = 'MANUAL_APPROVED',
      ai_review_reason = 'MASTER_ADMIN_APPROVED_TESTNET',
      ai_reviewed_at = now(),
      verified_at = now(),
      network = 'TRON TESTNET',
      token_contract = v_contract,
      raw_amount = NULL,
      sender_address = NULL,
      block_timestamp = NULL,
      verification_source = 'MASTER_ADMIN_TESTNET_MANUAL',
      verification_note = 'Manually approved by Master Admin as an allowlisted TRON TESTNET test credit. No TXID was supplied; this path cannot credit Mainnet funds.'
  WHERE id = d.id
    AND status = 'PENDING_VERIFICATION'
  RETURNING * INTO d;

  IF d.id IS NULL OR d.status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Deposit state changed before test credit could be recorded';
  END IF;

  UPDATE public.users
  SET current_platform_balance = COALESCE(current_platform_balance,0) + v_credit,
      principal_balance = COALESCE(principal_balance,0) + v_credit
  WHERE id = v_user.id;

  INSERT INTO public.account_ledger(
    user_id, entry_type, amount, description, actor_user_id, reference_id, metadata
  ) VALUES (
    v_user.id, 'USER_DEPOSIT', v_credit,
    'Master Admin approved TRON TESTNET manual test credit',
    v_actor.id, d.id::text,
    jsonb_build_object(
      'gross',d.gross_amount,
      'fee',d.deposit_fee,
      'network','TRON TESTNET',
      'manual_approval',true,
      'verification_source','MASTER_ADMIN_TESTNET_MANUAL',
      'approved_by',v_actor.id,
      'txid',NULL
    )
  );

  INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
  VALUES(
    v_actor.id, v_user.id, 'DEPOSIT_MANUALLY_APPROVED_TESTNET',
    'Master Admin manually approved an allowlisted Shasta test credit; no transaction ID was supplied.',
    d.id::text
  );

  RETURN d;
END;
$function$;

COMMENT ON FUNCTION public.apply_manual_testnet_deposit_approval(uuid,uuid)
IS 'One-click Master Admin testnet-only manual deposit credit. Requires evidence, an allowlisted Shasta test account, its active assigned wallet, a separate pinned test treasury, and all production/live-money gates closed. Never credits Mainnet and is idempotent.';

REVOKE ALL ON FUNCTION public.apply_manual_testnet_deposit_approval(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_manual_testnet_deposit_approval(uuid,uuid) TO service_role;

COMMIT;

-- Restrict client withdrawal requests to USER profiles and refund only payouts
-- that the transfer service can prove were not broadcast.
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount NUMERIC)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_balance NUMERIC;
  v_withdrawal_held NUMERIC;
  v_pending NUMERIC;
  v_wallet TEXT;
  v_status TEXT;
  v_request_id UUID;
  v_fee_rate NUMERIC := 0.10;
  v_fee NUMERIC;
  v_net NUMERIC;
  v_risk NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;

  v_user_id := public.current_app_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;

  SELECT role, current_platform_balance, withdrawal_held, destination_address, status
    INTO v_role, v_balance, v_withdrawal_held, v_wallet, v_status
    FROM public.users WHERE id = v_user_id FOR UPDATE;
  IF v_role <> 'USER' THEN RAISE EXCEPTION 'Only client accounts may request withdrawals'; END IF;
  IF upper(COALESCE(v_status, '')) IN ('BLOCKED','SUSPENDED','DELETED') THEN
    RAISE EXCEPTION 'This account is not allowed to request withdrawals';
  END IF;
  IF p_amount IS NULL OR p_amount < 50 THEN RAISE EXCEPTION 'Minimum withdrawal is $50'; END IF;
  IF COALESCE(v_wallet, '') = '' THEN RAISE EXCEPTION 'Link a withdrawal wallet before requesting a withdrawal'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kyc_verifications WHERE user_id = v_user_id AND status = 'VERIFIED') THEN
    RAISE EXCEPTION 'Complete KYC verification before requesting a withdrawal';
  END IF;

  SELECT COALESCE((value_json ->> 'fee_rate')::NUMERIC, 0.10)
    INTO v_fee_rate FROM public.platform_settings WHERE key = 'withdrawal_rules';
  v_fee_rate := LEAST(0.25, GREATEST(0, COALESCE(v_fee_rate, 0.10)));
  v_fee := round(p_amount * v_fee_rate, 2);
  v_net := p_amount - v_fee;
  v_risk := round(least(0.35, greatest(0.02, p_amount / 5000)), 4);

  SELECT COALESCE(sum(amount), 0) INTO v_pending
    FROM public.withdrawal_requests
    WHERE user_id = v_user_id AND status IN ('PENDING_APPROVAL','APPROVED','PROCESSING');
  IF p_amount > COALESCE(v_balance, 0) - GREATEST(COALESCE(v_withdrawal_held,0), v_pending) THEN
    RAISE EXCEPTION 'Withdrawal exceeds available balance';
  END IF;

  INSERT INTO public.withdrawal_requests(user_id, amount, destination_address, ai_risk_score, fee_amount, net_amount)
  VALUES(v_user_id, p_amount, v_wallet, v_risk, v_fee, v_net)
  RETURNING id INTO v_request_id;
  UPDATE public.users SET withdrawal_held = GREATEST(COALESCE(withdrawal_held,0), v_pending) + p_amount
    WHERE id = v_user_id;
  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_withdrawal(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.fail_unbroadcast_withdrawal(p_request_id UUID, p_error TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_amount NUMERIC;
BEGIN
  SELECT user_id, amount INTO v_user_id, v_amount
    FROM public.withdrawal_requests
    WHERE id = p_request_id
      AND status = 'PROCESSING'
      AND payout_txid IS NULL
      AND payout_started_at IS NOT NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.users SET current_platform_balance = current_platform_balance + v_amount
    WHERE id = v_user_id;
  UPDATE public.withdrawal_requests SET
    status = 'FAILED',
    telegram_status = 'FAILED',
    payout_error = left(COALESCE(NULLIF(trim(p_error),''),'Payout was not broadcast.'),500)
  WHERE id = p_request_id AND status = 'PROCESSING' AND payout_txid IS NULL;
  INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
  VALUES(NULL,v_user_id,'WITHDRAWAL_PAYOUT_FAILED','Payout failed before broadcast; reserved balance restored.',p_request_id::TEXT);
  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.fail_unbroadcast_withdrawal(UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_unbroadcast_withdrawal(UUID,TEXT) TO service_role;

-- Hardening applied after live Shop cycle rollout.
-- Legacy 3-argument withdrawal RPC is disabled from client/API roles.
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(numeric, text, numeric) FROM PUBLIC, anon, authenticated;

-- Active one-argument withdrawal flow: runtime and account-state gates.
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric)
RETURNS uuid
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
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication is required';
  END IF;
  IF NOT public.app_runtime_enabled() THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='AegisPay is paused by Master Admin';
  END IF;

  v_user_id := public.current_app_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AegisPay profile not found'; END IF;

  SELECT role,current_platform_balance,withdrawal_held,destination_address,status
    INTO v_role,v_balance,v_withdrawal_held,v_wallet,v_status
    FROM public.users WHERE id=v_user_id FOR UPDATE;

  IF v_role <> 'USER' THEN RAISE EXCEPTION 'Only client accounts may request withdrawals'; END IF;
  IF upper(COALESCE(v_status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION 'This account is not allowed to request withdrawals';
  END IF;
  IF p_amount IS NULL OR p_amount < 50 THEN RAISE EXCEPTION 'Minimum withdrawal is $50'; END IF;
  IF COALESCE(v_wallet,'')='' THEN RAISE EXCEPTION 'Link a withdrawal wallet before requesting a withdrawal'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_verifications WHERE user_id=v_user_id AND status='VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Complete KYC verification before requesting a withdrawal';
  END IF;

  SELECT COALESCE((value_json ->> 'fee_rate')::NUMERIC,0.10)
    INTO v_fee_rate FROM public.platform_settings WHERE key='withdrawal_rules';
  v_fee_rate := LEAST(0.25,GREATEST(0,COALESCE(v_fee_rate,0.10)));
  v_fee := round(p_amount*v_fee_rate,2);
  v_net := p_amount-v_fee;
  v_risk := round(least(0.35,greatest(0.02,p_amount/5000)),4);

  SELECT COALESCE(sum(amount),0) INTO v_pending
    FROM public.withdrawal_requests
    WHERE user_id=v_user_id AND status IN ('PENDING_APPROVAL','APPROVED','PROCESSING');

  IF p_amount > COALESCE(v_balance,0) - GREATEST(COALESCE(v_withdrawal_held,0),v_pending) THEN
    RAISE EXCEPTION 'Withdrawal exceeds available balance';
  END IF;

  INSERT INTO public.withdrawal_requests(
    user_id,amount,destination_address,ai_risk_score,fee_amount,net_amount
  ) VALUES(v_user_id,p_amount,v_wallet,v_risk,v_fee,v_net)
  RETURNING id INTO v_request_id;

  UPDATE public.users
    SET withdrawal_held=GREATEST(COALESCE(withdrawal_held,0),v_pending)+p_amount
    WHERE id=v_user_id;

  RETURN v_request_id;
END;
$function$;

-- Frozen client accounts cannot complete Shop tasks.
CREATE OR REPLACE FUNCTION public.complete_task(p_task_id uuid)
RETURNS public.cycle_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid:=public.current_app_user_id();
  t public.tasks;
  c public.cycle_runs;
  remaining integer;
  v_status text;
BEGIN
  IF COALESCE(public.current_app_role(),'')<>'USER' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Client access is required';
  END IF;
  IF NOT public.app_runtime_enabled() THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='AegisPay is paused by Master Admin';
  END IF;

  SELECT status INTO v_status FROM public.users WHERE id=v_user;
  IF upper(COALESCE(v_status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='This account is not active';
  END IF;

  SELECT * INTO t FROM public.tasks
    WHERE id=p_task_id AND user_id=v_user FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF t.cycle_id IS NULL THEN RAISE EXCEPTION 'This task is not attached to a Shop cycle'; END IF;

  SELECT * INTO c FROM public.cycle_runs
    WHERE id=t.cycle_id AND user_id=v_user FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
  IF c.status<>'TASKS_OPEN' THEN RAISE EXCEPTION 'This Shop cycle is not accepting task completion'; END IF;
  IF t.status='Completed' THEN RETURN c; END IF;

  UPDATE public.tasks
    SET status='Completed',progress=100,completion_date=CURRENT_DATE WHERE id=t.id;

  SELECT COUNT(*) INTO remaining
    FROM public.tasks WHERE cycle_id=c.id AND status<>'Completed';

  IF remaining=0 THEN
    UPDATE public.cycle_runs
      SET status='WAITING_18H',task_completed_at=NOW(),ready_at=NOW()+INTERVAL '18 hours'
      WHERE id=c.id RETURNING * INTO c;

    INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
    VALUES(v_user,'CYCLE_WAITING','18-hour settlement started',
      'All Shop tasks are complete. Your 18-hour settlement timer has started.',false);
  END IF;

  RETURN c;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_task(uuid) TO authenticated;

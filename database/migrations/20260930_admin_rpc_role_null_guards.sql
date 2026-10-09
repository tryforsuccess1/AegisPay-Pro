-- SQL NULL comparisons can make IF (current_app_role() <> 'MASTER ADMIN')
-- evaluate to NULL and fall through. Require a non-null role and an active
-- Master Admin profile in every authenticated financial/admin RPC.
CREATE OR REPLACE FUNCTION public.finalize_withdrawal(p_request_id UUID,p_approve BOOLEAN)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  w public.withdrawal_requests;
  v_actor UUID;
BEGIN
  v_actor := public.current_app_user_id();
  IF COALESCE(public.current_app_role(),'') <> 'MASTER ADMIN'
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=v_actor AND upper(COALESCE(status,'')) IN ('ACTIVE','NORMAL')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active Master Admin approval is required';
  END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Withdrawal decision is required'; END IF;
  SELECT * INTO w FROM public.withdrawal_requests
    WHERE id=p_request_id AND status='PENDING_APPROVAL' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already finalized'; END IF;
  IF w.panel_decision <> 'PENDING' THEN RAISE EXCEPTION 'Master Admin has already reviewed this withdrawal'; END IF;

  UPDATE public.withdrawal_requests SET
    panel_decision=CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
    panel_decided_at=now(), approved_by=v_actor, approval_date=now(),
    balance_deducted=CASE WHEN p_approve AND telegram_decision='APPROVED' THEN TRUE ELSE balance_deducted END,
    status=CASE WHEN NOT p_approve THEN 'REJECTED'
      WHEN telegram_decision='APPROVED' THEN 'APPROVED' ELSE 'PENDING_APPROVAL' END
    WHERE id=p_request_id RETURNING * INTO w;

  IF NOT p_approve THEN
    UPDATE public.users SET withdrawal_held=GREATEST(0,COALESCE(withdrawal_held,0)-w.amount) WHERE id=w.user_id;
  ELSIF w.telegram_decision='APPROVED' THEN
    UPDATE public.users SET
      withdrawal_held=GREATEST(0,COALESCE(withdrawal_held,0)-w.amount),
      current_platform_balance=GREATEST(0,current_platform_balance-w.amount)
      WHERE id=w.user_id;
  END IF;
  INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
    VALUES(v_actor,w.user_id,CASE WHEN p_approve THEN 'WITHDRAWAL_PANEL_APPROVED' ELSE 'WITHDRAWAL_PANEL_REJECTED' END,
      CASE WHEN p_approve THEN 'Master Admin recorded the panel decision for a withdrawal.' ELSE 'Master Admin rejected a withdrawal.' END,p_request_id::TEXT);
  RETURN w;
END;
$function$;
REVOKE ALL ON FUNCTION public.finalize_withdrawal(UUID,BOOLEAN) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_withdrawal(UUID,BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.master_admin_adjust_balance(p_user_id UUID,p_amount NUMERIC,p_type TEXT,p_reason TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor UUID;
  new_balance NUMERIC;
BEGIN
  v_actor := public.current_app_user_id();
  IF COALESCE(public.current_app_role(),'') <> 'MASTER ADMIN'
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=v_actor AND upper(COALESCE(status,'')) IN ('ACTIVE','NORMAL')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active Master Admin access is required';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF p_type NOT IN ('CREDIT','REVERSAL') THEN RAISE EXCEPTION 'Invalid adjustment type'; END IF;
  IF p_type='CREDIT' THEN
    UPDATE public.users SET current_platform_balance=current_platform_balance+p_amount,
      manual_credit_balance=manual_credit_balance+p_amount WHERE id=p_user_id RETURNING current_platform_balance INTO new_balance;
  ELSE
    UPDATE public.users SET current_platform_balance=GREATEST(0,current_platform_balance-p_amount),
      manual_credit_balance=GREATEST(0,manual_credit_balance-p_amount) WHERE id=p_user_id RETURNING current_platform_balance INTO new_balance;
  END IF;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  INSERT INTO public.admin_adjustments(user_id,admin_user_id,adjustment_type,amount,reason)
    VALUES(p_user_id,v_actor,p_type,p_amount,COALESCE(NULLIF(trim(p_reason),''),'Master Admin balance adjustment'));
  INSERT INTO public.account_ledger(user_id,entry_type,amount,description,actor_user_id,reference_id)
    VALUES(p_user_id,'MASTER_ADMIN_'||p_type,CASE WHEN p_type='CREDIT' THEN p_amount ELSE -p_amount END,
      COALESCE(NULLIF(trim(p_reason),''),'Master Admin balance adjustment'),v_actor,NULL);
  RETURN new_balance;
END;
$function$;
REVOKE ALL ON FUNCTION public.master_admin_adjust_balance(UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.master_admin_adjust_balance(UUID,NUMERIC,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_account_status(p_user_id UUID,p_status TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor UUID;
BEGIN
  v_actor := public.current_app_user_id();
  IF COALESCE(public.current_app_role(),'') <> 'MASTER ADMIN'
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=v_actor AND upper(COALESCE(status,'')) IN ('ACTIVE','NORMAL')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active Master Admin access is required';
  END IF;
  IF p_status NOT IN ('NORMAL','FROZEN','BLOCKED') THEN RAISE EXCEPTION 'Invalid account status'; END IF;
  UPDATE public.users SET status=p_status WHERE id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  RETURN p_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_user_account_status(UUID,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.set_user_account_status(UUID,TEXT) TO authenticated;


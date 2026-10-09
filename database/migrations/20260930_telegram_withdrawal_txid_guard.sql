-- A row carrying a transaction ID must be reconciled against the chain before
-- Telegram can make any further decision about that request.
CREATE OR REPLACE FUNCTION public.record_withdrawal_telegram_decision(
  p_request_id UUID, p_approve BOOLEAN, p_telegram_user_id TEXT
)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  w public.withdrawal_requests;
  v_was_deducted BOOLEAN;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authorized Telegram approver is required';
  END IF;
  SELECT * INTO w FROM public.withdrawal_requests
    WHERE id=p_request_id AND status IN ('PENDING_APPROVAL','APPROVED') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal is no longer awaiting Telegram review'; END IF;
  IF w.payout_txid IS NOT NULL THEN
    RAISE EXCEPTION 'A transaction ID exists; Master Admin reconciliation is required';
  END IF;
  IF w.telegram_decision <> 'PENDING' THEN RAISE EXCEPTION 'Telegram has already reviewed this withdrawal'; END IF;
  v_was_deducted := w.balance_deducted;

  UPDATE public.withdrawal_requests SET
    telegram_decision=CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
    telegram_approver_id=p_telegram_user_id, telegram_decided_at=now(),
    telegram_status=CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
    balance_deducted=CASE WHEN p_approve AND panel_decision='APPROVED' THEN TRUE WHEN NOT p_approve THEN FALSE ELSE balance_deducted END,
    status=CASE
      WHEN NOT p_approve THEN 'REJECTED'
      WHEN panel_decision='APPROVED' THEN 'APPROVED'
      ELSE 'PENDING_APPROVAL'
    END
    WHERE id=p_request_id RETURNING * INTO w;

  IF NOT p_approve THEN
    IF v_was_deducted THEN
      UPDATE public.users SET current_platform_balance=current_platform_balance+w.amount WHERE id=w.user_id;
    ELSE
      UPDATE public.users SET withdrawal_held=GREATEST(0,COALESCE(withdrawal_held,0)-w.amount) WHERE id=w.user_id;
    END IF;
  ELSIF w.panel_decision='APPROVED' AND w.status='APPROVED' AND NOT v_was_deducted THEN
    UPDATE public.users SET
      withdrawal_held=GREATEST(0,COALESCE(withdrawal_held,0)-w.amount),
      current_platform_balance=GREATEST(0,current_platform_balance-w.amount)
      WHERE id=w.user_id;
  END IF;
  INSERT INTO public.audit_events(actor_user_id,target_user_id,event_type,description,reference_id)
    VALUES(NULL,w.user_id,CASE WHEN p_approve THEN 'WITHDRAWAL_TELEGRAM_APPROVED' ELSE 'WITHDRAWAL_TELEGRAM_REJECTED' END,
      'An allowlisted Telegram approver recorded a withdrawal decision.',p_request_id::TEXT);
  RETURN w;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_withdrawal_telegram_decision(UUID,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_telegram_decision(UUID,BOOLEAN,TEXT) TO service_role;


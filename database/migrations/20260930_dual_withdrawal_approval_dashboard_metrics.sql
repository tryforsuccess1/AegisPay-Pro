-- Require a Master Admin decision and a Telegram approver decision before a
-- new withdrawal can become payable. Existing admin-approved, unpaid requests
-- retain their panel decision and wait for their Telegram decision.
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS panel_decision TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS panel_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_decision TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS telegram_approver_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_message_id TEXT,
  ADD COLUMN IF NOT EXISTS balance_deducted BOOLEAN NOT NULL DEFAULT FALSE;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='withdrawal_panel_decision_check') THEN
    ALTER TABLE public.withdrawal_requests ADD CONSTRAINT withdrawal_panel_decision_check
      CHECK (panel_decision IN ('PENDING','APPROVED','REJECTED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='withdrawal_telegram_decision_check') THEN
    ALTER TABLE public.withdrawal_requests ADD CONSTRAINT withdrawal_telegram_decision_check
      CHECK (telegram_decision IN ('PENDING','APPROVED','REJECTED'));
  END IF;
END;
$constraints$;

-- Preserve earlier Master Admin decisions without treating Telegram as having
-- approved them. Previously paid rows remain historical and are never replayed.
UPDATE public.withdrawal_requests
SET panel_decision = CASE
      WHEN status IN ('APPROVED','PROCESSING','PAID') THEN 'APPROVED'
      WHEN status = 'REJECTED' THEN 'REJECTED'
      ELSE 'PENDING'
    END,
    panel_decided_at = CASE
      WHEN status IN ('APPROVED','PROCESSING','PAID') THEN COALESCE(approval_date, created_at)
      WHEN status = 'REJECTED' THEN COALESCE(approval_date, created_at)
      ELSE panel_decided_at
    END,
    balance_deducted = CASE WHEN status IN ('APPROVED','PROCESSING','PAID') THEN TRUE ELSE balance_deducted END
WHERE panel_decision='PENDING' AND status IN ('APPROVED','PROCESSING','PAID','REJECTED');

CREATE INDEX IF NOT EXISTS withdrawal_requests_dual_approval_idx
  ON public.withdrawal_requests(status, panel_decision, telegram_decision, created_at DESC);

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
  IF public.current_app_role() <> 'MASTER ADMIN' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Master Admin approval is required';
  END IF;
  v_actor := public.current_app_user_id();
  SELECT * INTO w FROM public.withdrawal_requests
    WHERE id=p_request_id AND status='PENDING_APPROVAL' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already finalized'; END IF;
  IF w.panel_decision <> 'PENDING' THEN RAISE EXCEPTION 'Master Admin has already reviewed this withdrawal'; END IF;

  UPDATE public.withdrawal_requests SET
    panel_decision=CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
    panel_decided_at=now(), approved_by=v_actor, approval_date=now(),
    balance_deducted=CASE WHEN p_approve AND telegram_decision='APPROVED' THEN TRUE ELSE balance_deducted END,
    status=CASE
      WHEN NOT p_approve THEN 'REJECTED'
      WHEN telegram_decision='APPROVED' THEN 'APPROVED'
      ELSE 'PENDING_APPROVAL'
    END
    WHERE id=p_request_id RETURNING * INTO w;

  IF NOT p_approve THEN
    UPDATE public.users SET withdrawal_held=GREATEST(0,COALESCE(withdrawal_held,0)-w.amount)
      WHERE id=w.user_id;
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
REVOKE ALL ON FUNCTION public.finalize_withdrawal(UUID,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_withdrawal(UUID,BOOLEAN) TO authenticated;

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
    IF v_was_deducted AND w.payout_txid IS NULL THEN
      -- Restore a pre-migration approved reservation that was never paid.
      UPDATE public.users SET current_platform_balance=current_platform_balance+w.amount
        WHERE id=w.user_id;
    ELSE
      UPDATE public.users SET withdrawal_held=GREATEST(0,COALESCE(withdrawal_held,0)-w.amount)
        WHERE id=w.user_id;
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

CREATE OR REPLACE FUNCTION public.aegispay_admin_dashboard_totals(p_admin_auth_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id UUID;
  v_totals JSONB;
BEGIN
  SELECT id INTO v_user_id FROM public.users
    WHERE auth_user_id=p_admin_auth_user_id AND role='MASTER ADMIN'
      AND upper(COALESCE(status,'')) IN ('ACTIVE','NORMAL') LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Active Master Admin access required'; END IF;
  SELECT jsonb_build_object(
    'confirmedDepositsUsdt',COALESCE((SELECT sum(gross_amount) FROM public.deposit_submissions WHERE status='VERIFIED'),0),
    'creditedDepositsUsdt',COALESCE((SELECT sum(credited_amount) FROM public.deposit_submissions WHERE status='VERIFIED'),0),
    'completedWithdrawalsCount',COALESCE((SELECT count(*) FROM public.withdrawal_requests WHERE status='PAID'),0),
    'completedWithdrawalsUsdt',COALESCE((SELECT sum(net_amount) FROM public.withdrawal_requests WHERE status='PAID'),0)
  ) INTO v_totals;
  RETURN v_totals;
END;
$function$;
REVOKE ALL ON FUNCTION public.aegispay_admin_dashboard_totals(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aegispay_admin_dashboard_totals(UUID) TO service_role;

-- Permit only a separate testnet signer path. Mainnet payout settings remain
-- off and are not changed by this migration.
UPDATE public.platform_settings SET value_json=value_json||jsonb_build_object('testnet_payouts',true),updated_at=now()
  WHERE key='system_mode' AND value_json->>'mode'='TESTNET_DEMO';


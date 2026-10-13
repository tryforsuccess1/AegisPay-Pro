-- Preserve explicit human withdrawal approval and make balance/ledger mutations atomic.
-- The Master Admin panel decision and Telegram approver decision may arrive in either order.
-- Funds are deducted only after both decisions approve; AI may assess risk but cannot approve payouts.
BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT reference_id
    FROM public.account_ledger
    WHERE entry_type = 'WITHDRAWAL_DEBIT'
      AND reference_id IS NOT NULL
      AND btrim(reference_id) <> ''
    GROUP BY reference_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate withdrawal debit references already exist; manual reconciliation required';
  END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS account_ledger_withdrawal_debit_reference_uq
  ON public.account_ledger(reference_id)
  WHERE entry_type = 'WITHDRAWAL_DEBIT'
    AND reference_id IS NOT NULL
    AND btrim(reference_id) <> '';

CREATE OR REPLACE FUNCTION public.finalize_withdrawal(
  p_request_id uuid,
  p_approve boolean
)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  w public.withdrawal_requests;
  v_actor uuid;
  v_new_balance numeric;
BEGIN
  v_actor := public.current_app_user_id();

  IF COALESCE(public.current_app_role(), '') <> 'MASTER ADMIN'
     OR NOT EXISTS (
       SELECT 1 FROM public.users
       WHERE id = v_actor
         AND upper(COALESCE(status, '')) IN ('ACTIVE', 'NORMAL')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin approval is required';
  END IF;
  IF p_request_id IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A withdrawal request and decision are required';
  END IF;

  SELECT * INTO w
  FROM public.withdrawal_requests
  WHERE id = p_request_id AND status = 'PENDING_APPROVAL'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found or no longer pending'; END IF;
  IF w.panel_decision IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Master Admin has already reviewed this withdrawal';
  END IF;
  IF w.amount IS NULL OR w.amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount is invalid; manual reconciliation required';
  END IF;
  IF w.balance_deducted IS TRUE OR w.payout_txid IS NOT NULL OR w.payout_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawal has an existing debit or payout attempt; manual reconciliation required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_ledger
    WHERE entry_type = 'WITHDRAWAL_DEBIT' AND reference_id = p_request_id::text
  ) THEN
    RAISE EXCEPTION 'A withdrawal debit already exists for this request; manual reconciliation required';
  END IF;

  IF NOT p_approve THEN
    -- Rejecting releases the reservation only. A debit must never be hidden by
    -- clamping a balance or silently refunding an inconsistent historical row.
    UPDATE public.users
       SET withdrawal_held = withdrawal_held - w.amount
     WHERE id = w.user_id
       AND withdrawal_held >= w.amount;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Withdrawal reservation is inconsistent; manual reconciliation required';
    END IF;

    UPDATE public.withdrawal_requests
       SET panel_decision = 'REJECTED',
           panel_decided_at = now(),
           approved_by = NULL,
           approval_date = NULL,
           balance_deducted = false,
           status = 'REJECTED'
     WHERE id = p_request_id
     RETURNING * INTO w;
  ELSE
    -- If Telegram has already approved, both gates are satisfied and the debit
    -- is applied atomically. Otherwise record only the panel decision and wait
    -- for the human Telegram decision; no balance mutation occurs yet.
    IF w.telegram_decision = 'REJECTED' THEN
      RAISE EXCEPTION 'Telegram rejected this withdrawal; it cannot be approved by the panel';
    END IF;

    IF w.telegram_decision = 'APPROVED' THEN
      PERFORM 1
      FROM public.users
      WHERE id = w.user_id
        AND upper(COALESCE(status, '')) IN ('ACTIVE', 'NORMAL')
        AND current_platform_balance >= w.amount
        AND withdrawal_held >= w.amount
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient balance, inactive user, or inconsistent withdrawal reservation';
      END IF;

      UPDATE public.users
         SET current_platform_balance = current_platform_balance - w.amount,
             withdrawal_held = withdrawal_held - w.amount
       WHERE id = w.user_id
      RETURNING current_platform_balance INTO v_new_balance;

      INSERT INTO public.account_ledger(
        user_id, entry_type, amount, description, actor_user_id, reference_id, metadata
      ) VALUES (
        w.user_id, 'WITHDRAWAL_DEBIT', -w.amount,
        'Withdrawal amount deducted after both Master Admin and Telegram approval',
        v_actor, p_request_id::text,
        jsonb_build_object(
          'withdrawal_id', p_request_id,
          'gross_amount', w.amount,
          'balance_after', v_new_balance,
          'approval_gate', 'MASTER_ADMIN_AND_TELEGRAM'
        )
      );

      UPDATE public.withdrawal_requests
         SET panel_decision = 'APPROVED',
             panel_decided_at = now(),
             approved_by = v_actor,
             approval_date = now(),
             balance_deducted = true,
             status = 'APPROVED'
       WHERE id = p_request_id
      RETURNING * INTO w;
    ELSE
      UPDATE public.withdrawal_requests
         SET panel_decision = 'APPROVED',
             panel_decided_at = now(),
             approved_by = v_actor,
             approval_date = now(),
             balance_deducted = false,
             status = 'PENDING_APPROVAL'
       WHERE id = p_request_id
      RETURNING * INTO w;
    END IF;
  END IF;

  INSERT INTO public.audit_events(actor_user_id, target_user_id, event_type, description, reference_id)
  VALUES (
    v_actor, w.user_id,
    CASE WHEN p_approve THEN 'WITHDRAWAL_PANEL_APPROVED' ELSE 'WITHDRAWAL_PANEL_REJECTED' END,
    CASE
      WHEN NOT p_approve THEN 'Master Admin rejected the withdrawal and released its reservation.'
      WHEN w.status = 'APPROVED' THEN 'Master Admin approved the withdrawal after Telegram approval; the debit was recorded atomically.'
      ELSE 'Master Admin approved the panel step; awaiting the separate human Telegram decision.'
    END,
    p_request_id::text
  );
  RETURN w;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_withdrawal_telegram_decision(
  p_request_id uuid,
  p_approve boolean,
  p_telegram_user_id text
)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  w public.withdrawal_requests;
  v_new_balance numeric;
BEGIN
  IF p_request_id IS NULL OR p_approve IS NULL
     OR p_telegram_user_id IS NULL
     OR p_telegram_user_id !~ '^[0-9]{1,20}$' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'An authorized Telegram approver and explicit decision are required';
  END IF;

  SELECT * INTO w
  FROM public.withdrawal_requests
  WHERE id = p_request_id AND status = 'PENDING_APPROVAL'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal is no longer awaiting the Telegram decision';
  END IF;
  IF w.telegram_decision IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Telegram has already reviewed this withdrawal';
  END IF;
  IF w.amount IS NULL OR w.amount <= 0
     OR w.balance_deducted IS TRUE
     OR w.payout_txid IS NOT NULL
     OR w.payout_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawal amount/state is inconsistent; manual reconciliation required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_ledger
    WHERE entry_type = 'WITHDRAWAL_DEBIT' AND reference_id = p_request_id::text
  ) THEN
    RAISE EXCEPTION 'A withdrawal debit already exists for this request; manual reconciliation required';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.users
       SET withdrawal_held = withdrawal_held - w.amount
     WHERE id = w.user_id
       AND withdrawal_held >= w.amount;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Withdrawal reservation is inconsistent; manual reconciliation required';
    END IF;

    UPDATE public.withdrawal_requests
       SET telegram_decision = 'REJECTED',
           telegram_approver_id = p_telegram_user_id,
           telegram_decided_at = now(),
           telegram_status = 'REJECTED',
           balance_deducted = false,
           status = 'REJECTED'
     WHERE id = p_request_id
    RETURNING * INTO w;
  ELSE
    IF w.panel_decision = 'APPROVED' THEN
      PERFORM 1
      FROM public.users
      WHERE id = w.user_id
        AND upper(COALESCE(status, '')) IN ('ACTIVE', 'NORMAL')
        AND current_platform_balance >= w.amount
        AND withdrawal_held >= w.amount
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient balance, inactive user, or inconsistent withdrawal reservation';
      END IF;

      UPDATE public.users
         SET current_platform_balance = current_platform_balance - w.amount,
             withdrawal_held = withdrawal_held - w.amount
       WHERE id = w.user_id
      RETURNING current_platform_balance INTO v_new_balance;

      INSERT INTO public.account_ledger(
        user_id, entry_type, amount, description, actor_user_id, reference_id, metadata
      ) VALUES (
        w.user_id, 'WITHDRAWAL_DEBIT', -w.amount,
        'Withdrawal amount deducted after both Master Admin and Telegram approval',
        NULL, p_request_id::text,
        jsonb_build_object(
          'withdrawal_id', p_request_id,
          'gross_amount', w.amount,
          'balance_after', v_new_balance,
          'approval_gate', 'MASTER_ADMIN_AND_TELEGRAM',
          'telegram_approver_id', p_telegram_user_id
        )
      );

      UPDATE public.withdrawal_requests
         SET telegram_decision = 'APPROVED',
             telegram_approver_id = p_telegram_user_id,
             telegram_decided_at = now(),
             telegram_status = 'APPROVED',
             balance_deducted = true,
             status = 'APPROVED'
       WHERE id = p_request_id
      RETURNING * INTO w;
    ELSE
      UPDATE public.withdrawal_requests
         SET telegram_decision = 'APPROVED',
             telegram_approver_id = p_telegram_user_id,
             telegram_decided_at = now(),
             telegram_status = 'APPROVED',
             balance_deducted = false,
             status = 'PENDING_APPROVAL'
       WHERE id = p_request_id
      RETURNING * INTO w;
    END IF;
  END IF;

  INSERT INTO public.audit_events(actor_user_id, target_user_id, event_type, description, reference_id)
  VALUES (
    NULL, w.user_id,
    CASE WHEN p_approve THEN 'WITHDRAWAL_TELEGRAM_APPROVED' ELSE 'WITHDRAWAL_TELEGRAM_REJECTED' END,
    CASE
      WHEN NOT p_approve THEN 'Authorized human Telegram approver rejected the withdrawal and its reservation was released.'
      WHEN w.status = 'APPROVED' THEN 'Authorized human Telegram approver completed the final approval gate; debit was recorded atomically.'
      ELSE 'Authorized human Telegram approver approved; awaiting the Master Admin panel decision.'
    END,
    p_request_id::text
  );
  RETURN w;
END;
$function$;

-- AI is a risk-review assistant only. It is never allowed to move funds,
-- bypass the Telegram decision, or transition a withdrawal to APPROVED.
CREATE OR REPLACE FUNCTION public.auto_approve_withdrawal(
  p_request_id uuid,
  p_confidence numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  w public.withdrawal_requests;
BEGIN
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'MANUAL_REVIEW',
      'decision', 'MANUAL_REVIEW',
      'reason', 'WITHDRAWAL_REQUEST_REQUIRED',
      'requiresManualReview', true
    );
  END IF;

  SELECT * INTO w
  FROM public.withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'MANUAL_REVIEW',
      'decision', 'MANUAL_REVIEW',
      'reason', 'WITHDRAWAL_NOT_FOUND',
      'requiresManualReview', true
    );
  END IF;

  RETURN jsonb_build_object(
    'status', w.status,
    'decision', 'MANUAL_REVIEW',
    'reason', 'TELEGRAM_HUMAN_APPROVAL_REQUIRED',
    'requiresManualReview', true,
    'aiConfidence', p_confidence,
    'note', 'AI risk review cannot approve or debit a withdrawal; a human Telegram decision and Master Admin panel decision are required.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_withdrawal(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_withdrawal(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.record_withdrawal_telegram_decision(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_telegram_decision(uuid, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public.auto_approve_withdrawal(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_approve_withdrawal(uuid, numeric, text) TO service_role;

COMMENT ON FUNCTION public.finalize_withdrawal(uuid, boolean)
IS 'Master Admin panel decision; both panel and explicit human Telegram approval are required before atomically debiting a withdrawal.';
COMMENT ON FUNCTION public.record_withdrawal_telegram_decision(uuid, boolean, text)
IS 'Service-role-only Telegram decision; human approval is required and the final debit is atomically written once after both approval gates.';
COMMENT ON FUNCTION public.auto_approve_withdrawal(uuid, numeric, text)
IS 'AI review only; always requires human Telegram and Master Admin approval and does not mutate financial state.';

COMMIT;

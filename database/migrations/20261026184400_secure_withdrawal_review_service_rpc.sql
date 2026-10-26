-- Keep the legacy user-scoped RPC inaccessible. The Master Admin Edge Function
-- validates the session and calls the replacement using the service role.
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_withdrawal(uuid, boolean)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finalize_withdrawal_as_admin(
  p_request_id uuid,
  p_approve boolean,
  p_actor_user_id uuid
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
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin approval is required';
  END IF;

  PERFORM 1
  FROM public.users
  WHERE id = p_actor_user_id
    AND upper(COALESCE(role, '')) = 'MASTER ADMIN'
    AND upper(COALESCE(status, '')) IN ('ACTIVE', 'NORMAL')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin approval is required';
  END IF;
  v_actor := p_actor_user_id;

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

REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_withdrawal_as_admin(uuid, boolean, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_withdrawal_as_admin(uuid, boolean, uuid)
TO service_role;

COMMENT ON FUNCTION public.finalize_withdrawal_as_admin(uuid, boolean, uuid) IS
  'Service-role-only withdrawal finalization called by admin-review after authenticating an active Master Admin; never expose direct execute to anon or authenticated clients.';

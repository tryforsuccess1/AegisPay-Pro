-- Record approved withdrawal balance deductions in the append-only financial ledger.
-- Backfill only the confirmed invalid-wallet refund path where the refund and audit
-- event prove the withdrawal was approved, deducted, then cancelled before broadcast.
BEGIN;

-- Do not silently ignore a pre-existing debit with a conflicting owner/amount,
-- and fail if legacy data already contains duplicate debits for one withdrawal.
-- This runs only against the same narrowly eligible refund-reconciliation cohort.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.withdrawal_requests AS w
    JOIN public.account_ledger AS debit
      ON debit.entry_type = 'WITHDRAWAL_DEBIT'
     AND debit.reference_id = w.id::text
    WHERE w.status = 'FAILED'
      AND w.balance_deducted IS FALSE
      AND w.payout_txid IS NULL
      AND w.payout_started_at IS NULL
      AND w.panel_decision = 'APPROVED'
      AND w.approved_by IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.account_ledger AS refund
        WHERE refund.user_id = w.user_id
          AND refund.entry_type = 'WITHDRAWAL_REFUND'
          AND refund.reference_id = w.id::text
          AND refund.amount = w.amount
      )
      AND EXISTS (
        SELECT 1 FROM public.audit_events AS ae
        WHERE ae.event_type = 'WITHDRAWAL_INVALID_WALLET_REFUNDED'
          AND ae.reference_id = w.id::text
      )
      AND (debit.user_id IS DISTINCT FROM w.user_id OR debit.amount IS DISTINCT FROM -w.amount)
  ) THEN
    RAISE EXCEPTION 'Conflicting WITHDRAWAL_DEBIT reference already exists; manual reconciliation required';
  END IF;

  IF EXISTS (
    SELECT debit.reference_id
    FROM public.withdrawal_requests AS w
    JOIN public.account_ledger AS debit
      ON debit.entry_type = 'WITHDRAWAL_DEBIT'
     AND debit.reference_id = w.id::text
    WHERE w.status = 'FAILED'
      AND w.balance_deducted IS FALSE
      AND w.payout_txid IS NULL
      AND w.payout_started_at IS NULL
      AND w.panel_decision = 'APPROVED'
      AND w.approved_by IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.account_ledger AS refund
        WHERE refund.user_id = w.user_id
          AND refund.entry_type = 'WITHDRAWAL_REFUND'
          AND refund.reference_id = w.id::text
          AND refund.amount = w.amount
      )
      AND EXISTS (
        SELECT 1 FROM public.audit_events AS ae
        WHERE ae.event_type = 'WITHDRAWAL_INVALID_WALLET_REFUNDED'
          AND ae.reference_id = w.id::text
      )
    GROUP BY debit.reference_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate WITHDRAWAL_DEBIT references already exist; manual reconciliation required';
  END IF;
END;
$$;

INSERT INTO public.account_ledger (
  user_id, actor_user_id, entry_type, amount, description, reference_id, metadata, created_at
)
SELECT
  w.user_id,
  w.approved_by,
  'WITHDRAWAL_DEBIT',
  -w.amount,
  'Withdrawal debit backfilled during ledger reconciliation',
  w.id::text,
  jsonb_build_object(
    'withdrawal_id', w.id,
    'audit_reconciliation', true,
    'reason', 'Approved withdrawal was deducted from balance but its debit ledger entry was missing',
    'original_approval_date', w.approval_date
  ),
  COALESCE(w.approval_date, w.created_at)
FROM public.withdrawal_requests AS w
WHERE w.status = 'FAILED'
  AND w.balance_deducted IS FALSE
  AND w.payout_txid IS NULL
  AND w.payout_started_at IS NULL
  AND w.panel_decision = 'APPROVED'
  AND w.approved_by IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.account_ledger AS refund
    WHERE refund.user_id = w.user_id
      AND refund.entry_type = 'WITHDRAWAL_REFUND'
      AND refund.reference_id = w.id::text
      AND refund.amount = w.amount
  )
  AND EXISTS (
    SELECT 1
    FROM public.audit_events AS ae
    WHERE ae.event_type = 'WITHDRAWAL_INVALID_WALLET_REFUNDED'
      AND ae.reference_id = w.id::text
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_ledger AS debit
    WHERE debit.entry_type = 'WITHDRAWAL_DEBIT'
      AND debit.reference_id = w.id::text
  );

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
       SELECT 1
       FROM public.users
       WHERE id = v_actor
         AND upper(COALESCE(status, '')) IN ('ACTIVE', 'NORMAL')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin approval is required';
  END IF;

  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Withdrawal decision is required';
  END IF;

  SELECT *
    INTO w
    FROM public.withdrawal_requests
   WHERE id = p_request_id
     AND status = 'PENDING_APPROVAL'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or already finalized';
  END IF;

  IF w.panel_decision IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Master Admin has already reviewed this withdrawal';
  END IF;

  -- Never deduct twice if a ledger debit already exists, and do not silently
  -- clamp a short balance to zero. Validate both balance and the held amount
  -- while locking the user's row before any approval mutation.
  IF p_approve THEN
    IF EXISTS (
      SELECT 1
      FROM public.account_ledger
      WHERE user_id = w.user_id
        AND entry_type = 'WITHDRAWAL_DEBIT'
        AND reference_id = p_request_id::text
    ) THEN
      RAISE EXCEPTION 'A withdrawal debit already exists for this request';
    END IF;

    PERFORM 1
    FROM public.users
    WHERE id = w.user_id
      AND COALESCE(current_platform_balance, 0) >= w.amount
      AND COALESCE(withdrawal_held, 0) >= w.amount
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient balance or withdrawal reservation for approval';
    END IF;
  END IF;

  UPDATE public.withdrawal_requests
     SET panel_decision = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
         panel_decided_at = now(),
         approved_by = v_actor,
         approval_date = now(),
         telegram_decision = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
         telegram_status = 'NOT_REQUIRED',
         telegram_approver_id = 'MASTER_ADMIN_SINGLE_APPROVAL',
         telegram_decided_at = now(),
         balance_deducted = CASE WHEN p_approve THEN TRUE ELSE FALSE END,
         status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END
   WHERE id = p_request_id
   RETURNING * INTO w;

  IF NOT p_approve THEN
    UPDATE public.users
       SET withdrawal_held = GREATEST(0, COALESCE(withdrawal_held, 0) - w.amount)
     WHERE id = w.user_id;
  ELSE
    UPDATE public.users
       SET withdrawal_held = COALESCE(withdrawal_held, 0) - w.amount,
           current_platform_balance = COALESCE(current_platform_balance, 0) - w.amount
     WHERE id = w.user_id
     RETURNING current_platform_balance INTO v_new_balance;

    -- The approval path changes the balance, so it must create the matching
    -- debit in the ledger in the same transaction. The reference guard prevents
    -- accidental duplication if a future workflow reuses this code.
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_ledger
      WHERE user_id = w.user_id
        AND entry_type = 'WITHDRAWAL_DEBIT'
        AND reference_id = p_request_id::text
        AND amount = -w.amount
    ) THEN
      INSERT INTO public.account_ledger (
        user_id, entry_type, amount, description, actor_user_id, reference_id, metadata
      )
      VALUES (
        w.user_id,
        'WITHDRAWAL_DEBIT',
        -w.amount,
        'Withdrawal amount deducted after Master Admin approval',
        v_actor,
        p_request_id::text,
        jsonb_build_object(
          'withdrawal_id', p_request_id,
          'gross_amount', w.amount,
          'balance_after', v_new_balance,
          'status', 'APPROVED'
        )
      );
    END IF;
  END IF;

  INSERT INTO public.audit_events(actor_user_id, target_user_id, event_type, description, reference_id)
  VALUES (
    v_actor,
    w.user_id,
    CASE WHEN p_approve THEN 'WITHDRAWAL_PANEL_APPROVED' ELSE 'WITHDRAWAL_PANEL_REJECTED' END,
    CASE WHEN p_approve
      THEN 'Master Admin approved the withdrawal under the single-approval workflow; live payout remains controlled by platform settings.'
      ELSE 'Master Admin rejected the withdrawal and released the reserved amount.'
    END,
    p_request_id::text
  );

  RETURN w;
END;
$function$;

COMMENT ON FUNCTION public.finalize_withdrawal(uuid, boolean)
IS 'Master Admin withdrawal decision; approved balance deductions are recorded in account_ledger atomically, while live payout remains controlled by production settings.';

COMMIT;

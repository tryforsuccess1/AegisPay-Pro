-- Prevent manual-credit reversals from exceeding the reversible credit or available balance.
-- Forward-only safety migration; keep all accounting mutations atomic.
CREATE OR REPLACE FUNCTION public.master_admin_adjust_balance(
  p_user_id uuid,
  p_amount numeric,
  p_type text,
  p_reason text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid;
  v_new_balance numeric;
  v_balance numeric;
  v_manual_credit_balance numeric;
  v_withdrawal_held numeric;
BEGIN
  v_actor := public.current_app_user_id();

  IF COALESCE(public.current_app_role(), '') <> 'MASTER ADMIN'
     OR NOT EXISTS (
       SELECT 1 FROM public.users
       WHERE id = v_actor
         AND upper(COALESCE(status, '')) IN ('ACTIVE', 'NORMAL')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active Master Admin access is required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A target user is required';
  END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Amount must be a finite positive number';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('CREDIT', 'REVERSAL') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid adjustment type';
  END IF;

  SELECT current_platform_balance, manual_credit_balance, withdrawal_held
    INTO v_balance, v_manual_credit_balance, v_withdrawal_held
    FROM public.users
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF p_type = 'CREDIT' THEN
    UPDATE public.users
       SET current_platform_balance = current_platform_balance + p_amount,
           manual_credit_balance = manual_credit_balance + p_amount
     WHERE id = p_user_id
     RETURNING current_platform_balance INTO v_new_balance;
  ELSE
    -- A reversal may only remove manual credits that remain in the account and
    -- are not reserved for a pending withdrawal. Never clamp the balance while
    -- writing a larger negative ledger entry.
    IF p_amount > COALESCE(v_manual_credit_balance, 0) THEN
      RAISE EXCEPTION 'Reversal exceeds the remaining manual credit balance';
    END IF;
    IF p_amount > COALESCE(v_balance, 0) - GREATEST(COALESCE(v_withdrawal_held, 0), 0) THEN
      RAISE EXCEPTION 'Reversal exceeds the available balance after withdrawal holds';
    END IF;

    UPDATE public.users
       SET current_platform_balance = current_platform_balance - p_amount,
           manual_credit_balance = manual_credit_balance - p_amount
     WHERE id = p_user_id
     RETURNING current_platform_balance INTO v_new_balance;
  END IF;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Balance adjustment failed';
  END IF;

  INSERT INTO public.admin_adjustments(
    user_id, admin_user_id, adjustment_type, amount, reason
  )
  VALUES (
    p_user_id, v_actor, p_type, p_amount,
    COALESCE(NULLIF(trim(p_reason), ''), 'Master Admin balance adjustment')
  );

  INSERT INTO public.account_ledger(
    user_id, entry_type, amount, description, actor_user_id, reference_id
  )
  VALUES (
    p_user_id,
    'MASTER_ADMIN_' || p_type,
    CASE WHEN p_type = 'CREDIT' THEN p_amount ELSE -p_amount END,
    COALESCE(NULLIF(trim(p_reason), ''), 'Master Admin balance adjustment'),
    v_actor,
    NULL
  );

  RETURN v_new_balance;
END;
$function$;

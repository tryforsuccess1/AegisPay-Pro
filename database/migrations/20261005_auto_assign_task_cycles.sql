-- Automatically open Shop task cycles while a client has available balance.
-- Master Admin task assignment is optional; the platform continues the cycle automatically
-- after settlement (and also repairs any positive-balance user with no open cycle).

CREATE OR REPLACE FUNCTION public.ensure_auto_task_cycle(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u public.users;
  t public.vip_tiers;
  c public.cycle_runs;
  offer_row RECORD;
  offer_count integer := 0;
  offer_index integer := 0;
  available_balance numeric(18,2);
  task_value numeric(18,2);
  task_reward numeric(18,2);
  remaining_value numeric(18,2);
  remaining_reward numeric(18,2);
  cycle_profit numeric(18,2);
  tier_rate numeric(18,8);
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO u
    FROM public.users
   WHERE id = p_user_id
   FOR UPDATE;

  IF u.id IS NULL
     OR u.role <> 'USER'
     OR upper(COALESCE(u.status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RETURN NULL;
  END IF;

  available_balance := ROUND(
    GREATEST(
      0,
      COALESCE(u.current_platform_balance,0)
        - GREATEST(COALESCE(u.withdrawal_held,0),0)
    ),
    2
  );

  IF available_balance <= 0 THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.cycle_runs
     WHERE user_id = u.id
       AND status IN ('TASKS_OPEN','WAITING_18H')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO t
    FROM public.vip_tiers
   WHERE id = u.selected_tier_id
     AND enabled = true
   FOR SHARE;

  IF t.id IS NULL THEN
    SELECT vt.*
      INTO t
      FROM public.cycle_runs cr
      JOIN public.vip_tiers vt ON vt.id = cr.tier_id
     WHERE cr.user_id = u.id
     ORDER BY cr.created_at DESC
     LIMIT 1
     FOR SHARE;
  END IF;

  IF t.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*)
    INTO offer_count
    FROM public.shop_offers so
    JOIN public.vip_tiers vt ON vt.id = so.tier_min_id
   WHERE so.status = 'ACTIVE'
     AND vt.enabled = true
     AND vt.display_order <= t.display_order
     AND so.product_id IS NOT NULL;

  IF offer_count <= 0 THEN
    RETURN NULL;
  END IF;

  tier_rate := CASE
    WHEN COALESCE(t.deposit_amount,0) > 0
      THEN COALESCE(t.initial_profit,0) / t.deposit_amount
    ELSE 0
  END;

  cycle_profit := ROUND(available_balance * tier_rate, 2);

  INSERT INTO public.cycle_runs(
    user_id,
    tier_id,
    cycle_base,
    status,
    profit_amount,
    source_deposit_id
  )
  VALUES(
    u.id,
    t.id,
    available_balance,
    'TASKS_OPEN',
    cycle_profit,
    NULL
  )
  RETURNING * INTO c;

  remaining_value := available_balance;
  remaining_reward := cycle_profit;

  FOR offer_row IN
    SELECT
      so.id,
      so.title,
      so.subtitle,
      so.task_level,
      so.instructions,
      so.product_id,
      vt.display_order
    FROM public.shop_offers so
    JOIN public.vip_tiers vt ON vt.id = so.tier_min_id
   WHERE so.status = 'ACTIVE'
     AND vt.enabled = true
     AND vt.display_order <= t.display_order
     AND so.product_id IS NOT NULL
   ORDER BY vt.display_order, so.created_at, so.id
  LOOP
    offer_index := offer_index + 1;

    IF offer_index = offer_count THEN
      task_value := ROUND(remaining_value, 2);
      task_reward := ROUND(remaining_reward, 2);
    ELSE
      task_value := ROUND(available_balance / offer_count, 2);
      task_reward := ROUND(cycle_profit / offer_count, 2);
      remaining_value := ROUND(remaining_value - task_value, 2);
      remaining_reward := ROUND(remaining_reward - task_reward, 2);
    END IF;

    INSERT INTO public.tasks(
      user_id,
      cycle_id,
      title,
      description,
      task_level,
      status,
      progress,
      reward,
      start_date,
      due_date,
      offer_id,
      task_value
    )
    VALUES(
      u.id,
      c.id,
      offer_row.title,
      COALESCE(
        offer_row.subtitle,
        offer_row.instructions,
        'Complete the assigned Shop task.'
      ),
      COALESCE(offer_row.task_level,'CLIENT'),
      'Pending',
      0,
      task_reward,
      CURRENT_DATE,
      CURRENT_DATE + 1,
      offer_row.id::text,
      task_value
    );
  END LOOP;

  INSERT INTO public.notifications(
    user_id,
    notification_type,
    title,
    body,
    is_read
  )
  VALUES(
    u.id,
    'CYCLE_AUTO_ASSIGNED',
    'New Shop tasks assigned automatically',
    'Your available balance is above $0. A new Shop task cycle has been opened automatically. No Master Admin task assignment is required. Complete the full task set to start the 18-hour settlement timer.',
    FALSE
  );

  RETURN c.id;
EXCEPTION
  WHEN unique_violation THEN
    -- Another server-side cycle creator won the race; keep the existing cycle.
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_auto_task_cycle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_auto_task_cycle(uuid) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS cycle_runs_one_open_cycle_per_user_idx
  ON public.cycle_runs(user_id)
  WHERE status IN ('TASKS_OPEN','WAITING_18H');

CREATE OR REPLACE FUNCTION public.settle_due_cycles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.cycle_runs;
  u public.users;
  t public.vip_tiers;
  settled integer := 0;
  v_rate numeric(18,8);
  v_profit numeric(18,2);
  auto_user record;
BEGIN
  FOR c IN
    SELECT *
      FROM public.cycle_runs
     WHERE status='WAITING_18H'
       AND ready_at IS NOT NULL
       AND ready_at<=NOW()
     FOR UPDATE SKIP LOCKED
  LOOP
    SELECT *
      INTO u
      FROM public.users
     WHERE id=c.user_id
     FOR UPDATE;

    IF u.id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT *
      INTO t
      FROM public.vip_tiers
     WHERE id=c.tier_id
     FOR SHARE;

    v_rate := CASE
      WHEN t.id IS NOT NULL AND COALESCE(t.deposit_amount,0) > 0
        THEN COALESCE(t.initial_profit,0) / t.deposit_amount
      ELSE 0
    END;

    v_profit := ROUND(COALESCE(c.cycle_base,0) * v_rate,2);

    UPDATE public.users
       SET current_platform_balance = COALESCE(current_platform_balance,0) + v_profit,
           profit_balance = COALESCE(profit_balance,0) + v_profit
     WHERE id=u.id;

    UPDATE public.cycle_runs
       SET status='SETTLED',
           settled_at=NOW(),
           profit_amount=v_profit
     WHERE id=c.id;

    INSERT INTO public.account_ledger(
      user_id,
      entry_type,
      amount,
      description,
      reference_id,
      metadata
    )
    VALUES(
      u.id,
      'CYCLE_PROFIT',
      v_profit,
      '18-hour Shop cycle settlement',
      c.id::TEXT,
      jsonb_build_object(
        'cycle_base',c.cycle_base,
        'profit',v_profit,
        'tier_id',c.tier_id,
        'tier_rate',v_rate
      )
    );

    INSERT INTO public.notifications(
      user_id,
      notification_type,
      title,
      body,
      is_read
    )
    VALUES(
      u.id,
      'CYCLE_SETTLED',
      'Profit credited',
      'Your 18-hour Shop cycle has settled and the new balance is available. A new Shop task cycle will be assigned automatically while your available balance remains above $0.',
      FALSE
    );

    settled := settled + 1;

    -- Keep the compounding cycle chain continuous without Master Admin assignment.
    PERFORM public.ensure_auto_task_cycle(u.id);
  END LOOP;

  -- Repair/continue any positive-balance client that currently has no open cycle.
  -- This also handles balances created by valid manual/admin credit operations.
  FOR auto_user IN
    SELECT u.id
      FROM public.users u
     WHERE u.role='USER'
       AND upper(COALESCE(u.status,'')) IN ('ACTIVE','NORMAL')
       AND ROUND(
         GREATEST(
           0,
           COALESCE(u.current_platform_balance,0)
             - GREATEST(COALESCE(u.withdrawal_held,0),0)
         ),
         2
       ) > 0
       AND NOT EXISTS (
         SELECT 1
           FROM public.cycle_runs cr
          WHERE cr.user_id=u.id
            AND cr.status IN ('TASKS_OPEN','WAITING_18H')
       )
  LOOP
    PERFORM public.ensure_auto_task_cycle(auto_user.id);
  END LOOP;

  RETURN settled;
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_due_cycles() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_due_cycles() TO service_role;

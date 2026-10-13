-- REFERENCE SNAPSHOT ONLY — NOT THE ORIGINAL MIGRATION SOURCE.
-- Captured read-only from live Supabase project wtcspnrmsoisroavojop on 2026-10-13.
-- This records the current deployed effect associated with ledger entry
-- 20261008002210 / vary_shop_task_values_by_product, whose original standalone
-- SQL body was not found in the retained repository history.
-- Do not replay this file against the existing production database. It is
-- intentionally outside database/migrations/ and does not alter migration history.
-- Review/reconcile before using it as part of any future clean bootstrap.

CREATE OR REPLACE FUNCTION public.ensure_auto_task_cycle(p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  weight_sum numeric(18,8);
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO u
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF u.id IS NULL
     OR u.role <> 'USER'
     OR upper(COALESCE(u.status,'')) NOT IN ('ACTIVE','NORMAL') THEN
    RETURN NULL;
  END IF;

  IF u.frozen_until IS NOT NULL AND u.frozen_until > NOW() THEN
    RETURN NULL;
  END IF;

  available_balance := ROUND(
    GREATEST(
      0,
      COALESCE(u.current_platform_balance,0)
        - GREATEST(COALESCE(u.withdrawal_held,0),0)
    ), 2
  );

  IF available_balance <= 0 THEN RETURN NULL; END IF;

  IF EXISTS (
    SELECT 1 FROM public.cycle_runs
    WHERE user_id=u.id AND status IN ('TASKS_OPEN','WAITING_18H')
  ) THEN
    RETURN NULL;
  END IF;

  IF COALESCE(u.selected_tier_id,'')='' THEN RETURN NULL; END IF;

  SELECT * INTO t
  FROM public.vip_tiers
  WHERE id=u.selected_tier_id
    AND enabled=true
    AND COALESCE(deposit_amount,0)<=available_balance
  FOR SHARE;

  IF t.id IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*), COALESCE(SUM(GREATEST(COALESCE(so.task_weight,1),0.0001)),0)
  INTO offer_count, weight_sum
  FROM public.shop_offers so
  JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
  WHERE so.status='ACTIVE'
    AND vt.enabled=true
    AND vt.display_order<=t.display_order
    AND so.product_id IS NOT NULL;

  IF offer_count<=0 OR weight_sum<=0 THEN RETURN NULL; END IF;

  tier_rate:=CASE WHEN COALESCE(t.deposit_amount,0)>0
    THEN COALESCE(t.initial_profit,0)/t.deposit_amount ELSE 0 END;

  cycle_profit:=ROUND(available_balance*tier_rate,2);

  INSERT INTO public.cycle_runs(
    user_id,tier_id,cycle_base,status,profit_amount,source_deposit_id
  )
  VALUES(u.id,t.id,available_balance,'TASKS_OPEN',cycle_profit,NULL)
  RETURNING * INTO c;

  remaining_value:=available_balance;
  remaining_reward:=cycle_profit;

  FOR offer_row IN
    SELECT
      so.id,
      so.title,
      so.subtitle,
      so.task_level,
      so.instructions,
      so.product_id,
      GREATEST(COALESCE(so.task_weight,1),0.0001) AS task_weight,
      vt.display_order
    FROM public.shop_offers so
    JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
    WHERE so.status='ACTIVE'
      AND vt.enabled=true
      AND vt.display_order<=t.display_order
      AND so.product_id IS NOT NULL
    ORDER BY vt.display_order,so.created_at,so.id
  LOOP
    offer_index:=offer_index+1;

    IF offer_index=offer_count THEN
      task_value:=ROUND(remaining_value,2);
      task_reward:=ROUND(remaining_reward,2);
    ELSE
      task_value:=ROUND(available_balance*offer_row.task_weight/weight_sum,2);
      task_reward:=ROUND(cycle_profit*offer_row.task_weight/weight_sum,2);
      remaining_value:=ROUND(remaining_value-task_value,2);
      remaining_reward:=ROUND(remaining_reward-task_reward,2);
    END IF;

    INSERT INTO public.tasks(
      user_id,cycle_id,title,description,task_level,status,progress,reward,
      start_date,due_date,offer_id,task_value
    )
    VALUES(
      u.id,c.id,offer_row.title,
      COALESCE(offer_row.subtitle,offer_row.instructions,'Complete the assigned Shop task.'),
      COALESCE(offer_row.task_level,'CLIENT'),'Pending',0,task_reward,
      CURRENT_DATE,CURRENT_DATE+1,offer_row.id::text,task_value
    );
  END LOOP;

  INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
  VALUES(
    u.id,'CYCLE_AUTO_ASSIGNED','New Shop tasks assigned',
    'Your selected tier is active and your Shop task cycle has been assigned automatically. Task values are weighted by the assigned product so purchase amounts can vary within each cycle. Complete each task individually; the 18-hour settlement starts when the final task is completed.',
    FALSE
  );

  RETURN c.id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$function$

-- Current execution grants checked from the live database:
REVOKE ALL ON FUNCTION public.ensure_auto_task_cycle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_auto_task_cycle(uuid) TO service_role;

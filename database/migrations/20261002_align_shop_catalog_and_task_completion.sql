-- Align Shop offers with catalog products and make task completion directly operable.
ALTER TABLE public.shop_offers
  ADD COLUMN IF NOT EXISTS product_id TEXT;

CREATE INDEX IF NOT EXISTS shop_offers_product_idx
  ON public.shop_offers(product_id);

UPDATE public.shop_offers
SET product_id = CASE
  WHEN title = 'Amazon Shopping Offer' THEN 'SP-4'
  WHEN title = 'Featured Product Review' THEN 'SP-8'
  WHEN title = 'Premium Product Discovery' THEN 'SP-16'
  ELSE product_id
END
WHERE product_id IS NULL;

CREATE OR REPLACE FUNCTION public.create_cycle_for_verified_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  u public.users; t public.vip_tiers; c public.cycle_runs; offer_row RECORD;
  offer_count integer:=0; offer_index integer:=0;
  task_value numeric(18,2); task_reward numeric(18,2);
  remaining_value numeric(18,2); remaining_reward numeric(18,2);
  cycle_base numeric(18,2);
BEGIN
  IF NEW.status<>'VERIFIED' OR COALESCE(OLD.status,'')='VERIFIED' THEN RETURN NEW; END IF;
  SELECT * INTO u FROM public.users WHERE id=NEW.user_id FOR UPDATE;
  SELECT * INTO t FROM public.vip_tiers WHERE id=NEW.tier_id AND enabled=true;
  IF u.id IS NULL OR t.id IS NULL THEN RETURN NEW; END IF;
  IF upper(coalesce(u.status,'')) NOT IN ('ACTIVE','NORMAL') THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.cycle_runs WHERE source_deposit_id=NEW.id) THEN RETURN NEW; END IF;

  cycle_base:=ROUND(GREATEST(0,COALESCE(NEW.gross_amount,0)-COALESCE(NEW.deposit_fee,0)),2);

  SELECT COUNT(*) INTO offer_count
  FROM public.shop_offers so JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
  WHERE so.status='ACTIVE' AND vt.enabled=true AND vt.display_order<=t.display_order
    AND so.product_id IS NOT NULL;

  INSERT INTO public.cycle_runs(user_id,tier_id,cycle_base,status,profit_amount,source_deposit_id)
  VALUES(u.id,t.id,cycle_base,'TASKS_OPEN',ROUND(COALESCE(t.initial_profit,0),2),NEW.id)
  RETURNING * INTO c;

  remaining_value:=cycle_base;
  remaining_reward:=ROUND(COALESCE(t.initial_profit,0),2);

  IF offer_count>0 THEN
    FOR offer_row IN
      SELECT so.id,so.title,so.subtitle,so.task_level,so.instructions,so.product_id,vt.display_order
      FROM public.shop_offers so JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
      WHERE so.status='ACTIVE' AND vt.enabled=true AND vt.display_order<=t.display_order
        AND so.product_id IS NOT NULL
      ORDER BY vt.display_order,so.created_at,so.id
    LOOP
      offer_index:=offer_index+1;
      IF offer_index=offer_count THEN
        task_value:=ROUND(remaining_value,2); task_reward:=ROUND(remaining_reward,2);
      ELSE
        task_value:=ROUND(cycle_base/offer_count,2);
        task_reward:=ROUND(COALESCE(t.initial_profit,0)/offer_count,2);
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
  END IF;

  INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
  VALUES(
    u.id,'CYCLE_STARTED','Shop cycle is ready',
    CASE WHEN offer_count>0 THEN
      'Your verified deposit created a new Shop cycle with assigned tasks. Open Shop, complete each mapped task, and the 18-hour settlement timer starts after the final task.'
    ELSE
      'Your verified deposit created a Shop cycle, but no mapped active Shop offers are configured yet.'
    END,false
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_cycle_for_verified_deposit() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.complete_task(p_task_id uuid)
RETURNS public.cycle_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_user uuid:=public.current_app_user_id(); t public.tasks; c public.cycle_runs; remaining integer; v_status text;
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

  SELECT * INTO t FROM public.tasks WHERE id=p_task_id AND user_id=v_user FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF t.cycle_id IS NULL THEN RAISE EXCEPTION 'This task is not attached to a Shop cycle'; END IF;

  SELECT * INTO c FROM public.cycle_runs WHERE id=t.cycle_id AND user_id=v_user FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
  IF c.status<>'TASKS_OPEN' THEN RAISE EXCEPTION 'This Shop cycle is not accepting task completion'; END IF;
  IF t.status='Completed' THEN RETURN c; END IF;

  UPDATE public.tasks SET status='Completed',progress=100,completion_date=CURRENT_DATE WHERE id=t.id;

  INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
  VALUES(v_user,'TASK_COMPLETED','Shop task completed',
    'The assigned Shop task "'||replace(t.title,'"','')||'" has been completed.',false);

  SELECT COUNT(*) INTO remaining FROM public.tasks WHERE cycle_id=c.id AND status<>'Completed';
  IF remaining=0 THEN
    UPDATE public.cycle_runs SET status='WAITING_18H',task_completed_at=NOW(),ready_at=NOW()+INTERVAL '18 hours'
    WHERE id=c.id RETURNING * INTO c;

    INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
    VALUES(v_user,'CYCLE_WAITING','18-hour settlement started',
      'All Shop tasks are complete. Your 18-hour settlement timer has started.',false);
  END IF;

  RETURN c;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_task(uuid) TO authenticated;

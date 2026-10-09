-- Live Shop cycle/task workflow hardening.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_value NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS cycle_id UUID REFERENCES public.cycle_runs(id);
ALTER TABLE public.cycle_runs ADD COLUMN IF NOT EXISTS source_deposit_id UUID UNIQUE REFERENCES public.deposit_submissions(id);
CREATE INDEX IF NOT EXISTS tasks_cycle_idx ON public.tasks(cycle_id,start_date DESC);

DROP POLICY IF EXISTS tasks_user_update ON public.tasks;
DROP POLICY IF EXISTS tasks_master_update ON public.tasks;
DROP POLICY IF EXISTS tasks_master_all ON public.tasks;
CREATE POLICY shop_offers_master_insert ON public.shop_offers FOR INSERT WITH CHECK (public.current_app_role()='MASTER ADMIN');
CREATE POLICY shop_offers_master_update ON public.shop_offers FOR UPDATE USING (public.current_app_role()='MASTER ADMIN') WITH CHECK (public.current_app_role()='MASTER ADMIN');
CREATE POLICY shop_offers_master_delete ON public.shop_offers FOR DELETE USING (public.current_app_role()='MASTER ADMIN');

DROP POLICY IF EXISTS vip_tiers_master_all ON public.vip_tiers;

-- Server-side cycle creation is attached to verified deposits.
CREATE OR REPLACE FUNCTION public.create_cycle_for_verified_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.users; t public.vip_tiers; c public.cycle_runs; offer_row RECORD;
  offer_count integer:=0; offer_index integer:=0; task_value numeric(18,2); task_reward numeric(18,2);
  remaining_value numeric(18,2); remaining_reward numeric(18,2); cycle_base numeric(18,2);
BEGIN
 IF NEW.status<>'VERIFIED' OR COALESCE(OLD.status,'')='VERIFIED' THEN RETURN NEW; END IF;
 SELECT * INTO u FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 SELECT * INTO t FROM public.vip_tiers WHERE id=NEW.tier_id AND enabled=true;
 IF u.id IS NULL OR t.id IS NULL THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.cycle_runs WHERE source_deposit_id=NEW.id) THEN RETURN NEW; END IF;

 cycle_base:=ROUND(GREATEST(0,COALESCE(NEW.gross_amount,0)-COALESCE(NEW.deposit_fee,0)),2);
 SELECT COUNT(*) INTO offer_count FROM public.shop_offers so
   JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
   WHERE so.status='ACTIVE' AND vt.enabled=true AND vt.display_order<=t.display_order;

 INSERT INTO public.cycle_runs(user_id,tier_id,cycle_base,status,profit_amount,source_deposit_id)
 VALUES(u.id,t.id,cycle_base,'TASKS_OPEN',ROUND(COALESCE(t.initial_profit,0),2),NEW.id) RETURNING * INTO c;

 remaining_value:=cycle_base; remaining_reward:=ROUND(COALESCE(t.initial_profit,0),2);
 IF offer_count>0 THEN
  FOR offer_row IN SELECT so.id,so.title,so.subtitle,so.task_level,so.instructions,vt.display_order
    FROM public.shop_offers so JOIN public.vip_tiers vt ON vt.id=so.tier_min_id
    WHERE so.status='ACTIVE' AND vt.enabled=true AND vt.display_order<=t.display_order
    ORDER BY vt.display_order,so.created_at,so.id
  LOOP
   offer_index:=offer_index+1;
   IF offer_index=offer_count THEN
     task_value:=ROUND(remaining_value,2); task_reward:=ROUND(remaining_reward,2);
   ELSE
     task_value:=ROUND(cycle_base/offer_count,2); task_reward:=ROUND(COALESCE(t.initial_profit,0)/offer_count,2);
     remaining_value:=ROUND(remaining_value-task_value,2);
     remaining_reward:=ROUND(remaining_reward-task_reward,2);
   END IF;
   INSERT INTO public.tasks(user_id,cycle_id,title,description,task_level,status,progress,reward,start_date,due_date,offer_id,task_value)
   VALUES(u.id,c.id,offer_row.title,COALESCE(offer_row.subtitle,offer_row.instructions,'Complete the assigned Shop task.'),
     COALESCE(offer_row.task_level,'CLIENT'),'Pending',0,task_reward,CURRENT_DATE,CURRENT_DATE+1,offer_row.id::text,task_value);
  END LOOP;
 END IF;

 INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
 VALUES(u.id,'CYCLE_STARTED','Shop cycle is ready',
   CASE WHEN offer_count>0 THEN
     'Your verified deposit created a new Shop task cycle. Complete all assigned tasks; when the full task balance reaches zero, the 18-hour settlement timer will start.'
   ELSE
     'Your verified deposit created a new Shop cycle, but no active Shop offers are configured yet. Please contact the Master Admin.'
   END,false);
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_cycle_for_verified_deposit ON public.deposit_submissions;
CREATE TRIGGER trg_create_cycle_for_verified_deposit
AFTER UPDATE OF status ON public.deposit_submissions
FOR EACH ROW EXECUTE FUNCTION public.create_cycle_for_verified_deposit();
REVOKE ALL ON FUNCTION public.create_cycle_for_verified_deposit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_task(p_task_id uuid)
RETURNS public.cycle_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=public.current_app_user_id(); t public.tasks; c public.cycle_runs; remaining integer;
BEGIN
 IF COALESCE(public.current_app_role(),'')<>'USER' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Client access is required'; END IF;
 IF NOT public.app_runtime_enabled() THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='AegisPay is paused by Master Admin'; END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_task_id AND user_id=v_user FOR UPDATE;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
 IF t.cycle_id IS NULL THEN RAISE EXCEPTION 'This task is not attached to a Shop cycle'; END IF;
 SELECT * INTO c FROM public.cycle_runs WHERE id=t.cycle_id AND user_id=v_user FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Shop cycle not found'; END IF;
 IF c.status<>'TASKS_OPEN' THEN RAISE EXCEPTION 'This Shop cycle is not accepting task completion'; END IF;
 IF t.status='Completed' THEN RETURN c; END IF;
 UPDATE public.tasks SET status='Completed',progress=100,completion_date=CURRENT_DATE WHERE id=t.id;
 SELECT COUNT(*) INTO remaining FROM public.tasks WHERE cycle_id=c.id AND status<>'Completed';
 IF remaining=0 THEN
   UPDATE public.cycle_runs SET status='WAITING_18H',task_completed_at=NOW(),ready_at=NOW()+INTERVAL '18 hours'
     WHERE id=c.id RETURNING * INTO c;
   INSERT INTO public.notifications(user_id,notification_type,title,body,is_read)
   VALUES(v_user,'CYCLE_WAITING','18-hour settlement started','All Shop tasks are complete. Your 18-hour settlement timer has started.',false);
 END IF;
 RETURN c;
END $$;

REVOKE ALL ON FUNCTION public.complete_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_task(uuid) TO authenticated;

-- Expose only the runtime flag to the anonymous/authenticated client and keep all other platform settings private.
DROP POLICY IF EXISTS settings_runtime_read ON public.platform_settings;
CREATE POLICY settings_runtime_read ON public.platform_settings
  FOR SELECT TO anon,authenticated
  USING (key='app_runtime');
INSERT INTO public.platform_settings(key,value_json,updated_at)
VALUES('app_runtime','{"enabled":true}'::jsonb,now())
ON CONFLICT(key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=now();
CREATE OR REPLACE FUNCTION public.app_runtime_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT COALESCE((SELECT (value_json ->> 'enabled')::BOOLEAN FROM public.platform_settings WHERE key='app_runtime'),TRUE);
$$;
GRANT EXECUTE ON FUNCTION public.app_runtime_enabled() TO anon,authenticated;

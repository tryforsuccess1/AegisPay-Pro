-- Start the first Shop cycle immediately when an eligible client receives or regains available balance.
-- Existing settlement cron continues the cycle chain after the 18-hour WAITING_18H period.
-- No new tasks are created once available balance is zero.

CREATE OR REPLACE FUNCTION public.auto_assign_task_cycle_on_user_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.ensure_auto_task_cycle(NEW.id);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_assign_task_cycle_on_user_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auto_assign_task_cycle_on_user_change ON public.users;

CREATE TRIGGER trg_auto_assign_task_cycle_on_user_change
AFTER INSERT OR UPDATE OF current_platform_balance, withdrawal_held, selected_tier_id, status, role
ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_task_cycle_on_user_change();

-- Repair any eligible positive-balance clients immediately after deployment.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
      FROM public.users
     WHERE role = 'USER'
       AND upper(COALESCE(status,'')) IN ('ACTIVE','NORMAL')
       AND ROUND(
         GREATEST(
           0,
           COALESCE(current_platform_balance,0)
             - GREATEST(COALESCE(withdrawal_held,0),0)
         ), 2
       ) > 0
  LOOP
    PERFORM public.ensure_auto_task_cycle(r.id);
  END LOOP;
END;
$$;

-- Disposable PostgreSQL fixture for SECURITY DEFINER execute-grant regression tests.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'CREATE ROLE service_role NOLOGIN'; END IF;
END;
$roles$;

CREATE OR REPLACE FUNCTION public.ai_update_display_name(p_name text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$ SELECT p_name $fn$;
CREATE OR REPLACE FUNCTION public.finalize_withdrawal(p_request_id uuid, p_approve boolean)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$ SELECT p_request_id::text $fn$;
CREATE OR REPLACE FUNCTION public.get_production_readiness()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$ SELECT '{}'::jsonb $fn$;
CREATE OR REPLACE FUNCTION public.master_admin_adjust_balance(p_user_id uuid,p_amount numeric,p_type text,p_reason text)
RETURNS numeric LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$ SELECT p_amount $fn$;
CREATE OR REPLACE FUNCTION public.set_production_config(p_environment text,p_live_deposits_enabled boolean,p_real_payouts_enabled boolean,p_go_live_approved boolean,p_payouts_locked boolean)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$ SELECT '{}'::jsonb $fn$;

-- RLS policy helpers deliberately stay available to authenticated clients.
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$ SELECT 'USER'::text $fn$;
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$ SELECT NULL::uuid $fn$;

REVOKE ALL PRIVILEGES ON FUNCTION public.ai_update_display_name(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_withdrawal(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_production_readiness() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.master_admin_adjust_balance(uuid,numeric,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_production_config(text,boolean,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.current_app_role() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.current_app_user_id() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.ai_update_display_name(text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_withdrawal(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_readiness() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.master_admin_adjust_balance(uuid,numeric,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_production_config(text,boolean,boolean,boolean,boolean) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;

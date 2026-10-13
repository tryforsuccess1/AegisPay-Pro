-- Defense-in-depth for SECURITY DEFINER routines and explicit fail-closed policies.
-- Audited current routine bodies: app relations and custom public routine calls are schema-qualified.
-- The two event/evidence tables remain service-role-only; these policies do not grant clients access.
BEGIN;

ALTER FUNCTION public.admin_set_withdrawal_wallet(uuid, text) SET search_path = '';
ALTER FUNCTION public.ai_activate_tier(text) SET search_path = '';
ALTER FUNCTION public.ai_update_display_name(text) SET search_path = '';
ALTER FUNCTION public.apply_verified_deposit(uuid, text, text, timestamp with time zone, text) SET search_path = '';
ALTER FUNCTION public.auto_assign_task_cycle_on_user_change() SET search_path = '';
ALTER FUNCTION public.claim_aegispay_profile() SET search_path = '';
ALTER FUNCTION public.complete_task(uuid) SET search_path = '';
ALTER FUNCTION public.create_cycle_for_verified_deposit() SET search_path = '';
ALTER FUNCTION public.current_app_role() SET search_path = '';
ALTER FUNCTION public.current_app_user_id() SET search_path = '';
ALTER FUNCTION public.ensure_auto_task_cycle(uuid) SET search_path = '';
ALTER FUNCTION public.fail_unbroadcast_withdrawal(uuid, text) SET search_path = '';
ALTER FUNCTION public.get_production_readiness() SET search_path = '';
ALTER FUNCTION public.guard_app_runtime_mutations() SET search_path = '';
ALTER FUNCTION public.handle_new_aegispay_auth_user() SET search_path = '';
ALTER FUNCTION public.link_withdrawal_wallet(text, text) SET search_path = '';
ALTER FUNCTION public.link_withdrawal_wallet(text) SET search_path = '';
ALTER FUNCTION public.log_node_created() SET search_path = '';
ALTER FUNCTION public.log_referral_created() SET search_path = '';
ALTER FUNCTION public.log_task_completed() SET search_path = '';
ALTER FUNCTION public.log_withdrawal_created() SET search_path = '';
ALTER FUNCTION public.log_withdrawal_finalized() SET search_path = '';
ALTER FUNCTION public.request_withdrawal(numeric) SET search_path = '';
ALTER FUNCTION public.request_withdrawal(numeric, text, numeric) SET search_path = '';
ALTER FUNCTION public.resolve_login_email(text) SET search_path = '';
ALTER FUNCTION public.set_app_runtime_enabled(boolean) SET search_path = '';
ALTER FUNCTION public.set_my_language(text) SET search_path = '';
ALTER FUNCTION public.set_production_config(text, boolean, boolean, boolean, boolean) SET search_path = '';
ALTER FUNCTION public.settle_due_cycles() SET search_path = '';

DROP POLICY IF EXISTS ai_support_cases_deny_client_access ON public.ai_support_cases;
CREATE POLICY ai_support_cases_deny_client_access
  ON public.ai_support_cases
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS user_access_events_deny_client_access ON public.user_access_events;
CREATE POLICY user_access_events_deny_client_access
  ON public.user_access_events
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;

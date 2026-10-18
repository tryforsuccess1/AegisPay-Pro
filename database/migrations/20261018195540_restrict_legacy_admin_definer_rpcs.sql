-- Restrict legacy administrative SECURITY DEFINER RPCs to the privileged backend.
-- Active Client flows use the authenticated, owner-scoped RPCs; current administrative
-- control flows are routed through server-side Edge Functions. Keep service_role grants
-- where already present for trusted backend compatibility.
BEGIN;

REVOKE ALL PRIVILEGES ON FUNCTION public.ai_update_display_name(text) FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_withdrawal(uuid, boolean) FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_production_readiness() FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.master_admin_adjust_balance(uuid, numeric, text, text) FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_production_config(text, boolean, boolean, boolean, boolean) FROM authenticated;

COMMENT ON FUNCTION public.ai_update_display_name(text) IS
  'Legacy RPC. Direct authenticated execution is intentionally revoked; managed display-name updates use the privileged AegisPay support workflow.';
COMMENT ON FUNCTION public.finalize_withdrawal(uuid, boolean) IS
  'Legacy withdrawal approval RPC. Direct authenticated execution is intentionally revoked; withdrawal decisions must follow the current gated approval workflow.';
COMMENT ON FUNCTION public.get_production_readiness() IS
  'Privileged production-readiness helper. Direct authenticated execution is intentionally revoked.';
COMMENT ON FUNCTION public.master_admin_adjust_balance(uuid, numeric, text, text) IS
  'Legacy balance-adjustment RPC. Direct authenticated execution is intentionally revoked; current administrative operations use the server-side account-operations workflow.';
COMMENT ON FUNCTION public.set_production_config(text, boolean, boolean, boolean, boolean) IS
  'Privileged production-configuration RPC. Direct authenticated execution is intentionally revoked; production controls must use the server-side administrative workflow.';

COMMIT;

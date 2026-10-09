-- Reduce exposed SECURITY DEFINER RPC surface for Master Admin-only mutations.
REVOKE ALL ON FUNCTION public.master_admin_adjust_balance(uuid,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.master_admin_adjust_balance(uuid,numeric,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.set_user_account_status(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_account_status(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.set_app_runtime_enabled(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_app_runtime_enabled(boolean) TO service_role;
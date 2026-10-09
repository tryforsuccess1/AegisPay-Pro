-- The balance RPC authenticates the caller itself as Master Admin.
-- Granting EXECUTE to authenticated lets admin-account-ops invoke it
-- with the verified Master Admin JWT while SECURITY DEFINER enforces role/status.

BEGIN;
GRANT EXECUTE ON FUNCTION public.master_admin_adjust_balance(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
COMMIT;
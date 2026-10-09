-- Allow authenticated RLS policies to invoke the internal identity helper functions.
-- These helpers remain SECURITY DEFINER and are not exposed to anon.
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_app_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM anon;

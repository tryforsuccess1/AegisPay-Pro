-- Only the server-side checkout Edge Function may execute the atomic cycle checkout RPC.
REVOKE EXECUTE ON FUNCTION public.complete_shop_cycle_checkout(uuid,uuid,uuid[]) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.complete_shop_cycle_checkout(uuid,uuid,uuid[]) TO service_role;

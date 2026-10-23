-- Preserve the intentionally restricted access model for the legacy readiness RPC.
-- The browser Master Admin portal reads readiness via its authenticated Edge Function.
BEGIN;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_production_readiness() FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_production_readiness() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.get_production_readiness() IS
  'Privileged production-readiness helper. Direct authenticated execution is intentionally revoked; browser Master Admin reads use the authorized production-readiness Edge Function.';

COMMIT;

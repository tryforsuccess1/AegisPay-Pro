-- Keep the legacy readiness RPC restricted to trusted backend roles.
-- The browser Master Admin portal reads its readiness snapshot from the
-- Master-Admin-authorized production-readiness Edge Function instead.
BEGIN;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_production_readiness() FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_production_readiness() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.get_production_readiness() IS
  'Privileged production-readiness helper. Direct authenticated execution is intentionally revoked; browser Master Admin reads use the authorized production-readiness Edge Function.';

COMMIT;

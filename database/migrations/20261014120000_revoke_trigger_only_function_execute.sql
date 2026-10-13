-- Revoke direct RPC execution from a trigger-only validation function.
-- PostgreSQL checks EXECUTE privilege when a trigger is created, not on each
-- trigger invocation. Existing triggers continue to work after these grants
-- are revoked, while PostgREST no longer advertises this function as callable.
-- Keep service_role's grant for controlled maintenance; it is not exposed to clients.
REVOKE ALL ON FUNCTION public.enforce_valid_tron_withdrawal_address()
  FROM PUBLIC, anon, authenticated;

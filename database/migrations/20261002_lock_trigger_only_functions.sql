-- Trigger-only function; it must not be callable through the public RPC surface.
REVOKE ALL ON FUNCTION public.require_deposit_evidence_review() FROM PUBLIC, anon, authenticated, service_role;

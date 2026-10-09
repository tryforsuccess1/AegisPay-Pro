-- Security hardening for exposed SECURITY DEFINER RPCs.
-- Keep intended client/admin RPCs callable only by authenticated users and
-- remove legacy/unneeded signatures from the API surface.

REVOKE ALL ON FUNCTION public.admin_set_withdrawal_wallet(UUID,TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_withdrawal_wallet(UUID,TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.link_withdrawal_wallet(TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_withdrawal_wallet(TEXT)
  TO authenticated;

-- Legacy two-argument browser RPC is not used by the canonical client/admin
-- sources; remove it from both anonymous and authenticated API access.
REVOKE ALL ON FUNCTION public.link_withdrawal_wallet(TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;

-- Keep the currently active client withdrawal RPC authenticated-only.
REVOKE ALL ON FUNCTION public.request_withdrawal(NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC)
  TO authenticated;

-- Keep the Master Admin finalization RPC authenticated-only; its own body
-- enforces MASTER ADMIN + active status.
REVOKE ALL ON FUNCTION public.finalize_withdrawal(UUID,BOOLEAN)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_withdrawal(UUID,BOOLEAN)
  TO authenticated;

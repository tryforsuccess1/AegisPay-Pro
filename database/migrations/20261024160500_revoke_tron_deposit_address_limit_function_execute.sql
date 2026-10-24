-- The address limit is enforced only by the deposit_wallets INSERT trigger.
-- Public API callers must not be able to invoke its SECURITY DEFINER function directly.
REVOKE ALL ON FUNCTION public.enforce_tron_deposit_wallet_issue_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_tron_deposit_wallet_issue_limit() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_tron_deposit_wallet_issue_limit() FROM authenticated;

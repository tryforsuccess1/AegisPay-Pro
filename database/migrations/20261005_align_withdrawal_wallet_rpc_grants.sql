-- Align the withdrawal-wallet RPC grants with the canonical client.
-- The client uses the two-argument RPC so it can bind both the wallet address
-- and the wallet owner's profile-matching name. Retire the unused legacy
-- one-argument overload from the API surface.

REVOKE ALL ON FUNCTION public.link_withdrawal_wallet(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.link_withdrawal_wallet(TEXT, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.link_withdrawal_wallet(TEXT, TEXT)
  TO authenticated;

-- Retire direct client-side execution of the Master Admin wallet mutation RPC.
-- Wallet changes are now handled by the authenticated admin-account-ops Edge Function.
revoke execute on function public.admin_set_withdrawal_wallet(uuid, text) from authenticated;

-- Username login now resolves the profile on the server through username-login.
-- Remove the pre-auth RPC that directly returned registered email addresses.
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_login_email(text) FROM PUBLIC, anon, authenticated, service_role;

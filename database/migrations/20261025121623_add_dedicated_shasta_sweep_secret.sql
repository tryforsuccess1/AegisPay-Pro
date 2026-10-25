-- Dedicated credential for the isolated Shasta testnet sweep endpoint.
-- Generate it inside Postgres; the plaintext is stored only in Supabase Vault.
DO $secret$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'aegispay_testnet_sweep_cron'
  ) THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'aegispay_testnet_sweep_cron',
      'Dedicated caller credential for the isolated Shasta testnet deposit-wallet sweep function',
      NULL
    );
  END IF;
END
$secret$;

CREATE OR REPLACE FUNCTION public.verify_testnet_sweep_cron_secret(p_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_token IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'aegispay_testnet_sweep_cron'
        AND decrypted_secret = p_token
    );
$function$;

REVOKE ALL ON FUNCTION public.verify_testnet_sweep_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_testnet_sweep_cron_secret(text) TO service_role;

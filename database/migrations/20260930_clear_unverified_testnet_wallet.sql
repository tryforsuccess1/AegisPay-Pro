-- The existing address was configured for the old mainnet setting and has not
-- been verified as a controlled testnet wallet. Do not route test deposits to it.
UPDATE public.platform_settings
SET value_json = value_json || jsonb_build_object('receiving_address',''),
    updated_at = now()
WHERE key = 'deposit_rules';

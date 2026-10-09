-- AegisPay client deposit policy alignment
-- Deposits accept any positive amount. Tier selection is internal only.
-- No client-visible fixed deposit fee or minimum/maximum is configured.

UPDATE public.platform_settings
SET value_json = (value_json - 'min_deposit' - 'minimum_deposit')
                 || jsonb_build_object('fee',0),
    updated_at = NOW()
WHERE key = 'deposit_rules';
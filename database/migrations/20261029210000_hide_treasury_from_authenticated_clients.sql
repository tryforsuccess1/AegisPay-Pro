-- Keep treasury routing details out of ordinary authenticated client settings reads.
-- Client deposit pages receive only their request-scoped address from get-deposit-address.
DROP POLICY IF EXISTS settings_authenticated_read ON public.platform_settings;

CREATE POLICY settings_authenticated_read
ON public.platform_settings
FOR SELECT
TO authenticated
USING (
  key = 'app_runtime'
  OR private.current_app_role() = 'MASTER ADMIN'
);

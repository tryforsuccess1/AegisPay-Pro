-- Consolidate platform_settings RLS so runtime visibility and Master Admin access
-- do not create overlapping permissive SELECT policies.

DROP POLICY IF EXISTS settings_master ON public.platform_settings;
DROP POLICY IF EXISTS settings_runtime_read ON public.platform_settings;

CREATE POLICY settings_runtime_read_anon
  ON public.platform_settings
  FOR SELECT TO anon
  USING (key='app_runtime');

CREATE POLICY settings_authenticated_read
  ON public.platform_settings
  FOR SELECT TO authenticated
  USING (key='app_runtime' OR public.current_app_role()='MASTER ADMIN');

CREATE POLICY settings_master_write
  ON public.platform_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role()='MASTER ADMIN');

CREATE POLICY settings_master_update
  ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (public.current_app_role()='MASTER ADMIN')
  WITH CHECK (public.current_app_role()='MASTER ADMIN');

CREATE POLICY settings_master_delete
  ON public.platform_settings
  FOR DELETE TO authenticated
  USING (public.current_app_role()='MASTER ADMIN');

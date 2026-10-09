-- Make the runtime status RPC SECURITY INVOKER so the browser can query it
-- through the RLS policy without exposing a SECURITY DEFINER warning.
CREATE OR REPLACE FUNCTION public.app_runtime_enabled()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT (value_json ->> 'enabled')::BOOLEAN
     FROM public.platform_settings
     WHERE key = 'app_runtime'),
    TRUE
  );
$function$;

REVOKE ALL ON FUNCTION public.app_runtime_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_runtime_enabled() TO anon, authenticated;

REVOKE ALL ON TABLE public.activity_logs FROM anon, authenticated;
GRANT SELECT ON TABLE public.activity_logs TO authenticated;

REVOKE ALL ON TABLE public.vip_tiers FROM anon, authenticated;
GRANT SELECT ON TABLE public.vip_tiers TO authenticated;

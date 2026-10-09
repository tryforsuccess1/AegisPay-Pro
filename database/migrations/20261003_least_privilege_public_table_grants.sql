REVOKE ALL ON TABLE public.users, public.deposit_submissions, public.withdrawal_requests,
  public.account_ledger, public.admin_adjustments, public.audit_events,
  public.tasks, public.cycle_runs, public.referrals, public.kyc_verifications
  FROM anon, authenticated;

REVOKE ALL ON TABLE public.shop_offers FROM anon, authenticated;
REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;

REVOKE ALL ON TABLE public.platform_settings FROM anon, authenticated;
GRANT SELECT ON TABLE public.platform_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_settings TO authenticated;

GRANT SELECT ON TABLE public.users, public.deposit_submissions, public.withdrawal_requests,
  public.account_ledger, public.admin_adjustments, public.audit_events,
  public.tasks, public.cycle_runs, public.referrals, public.kyc_verifications
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_offers TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;

REVOKE ALL ON SEQUENCE public.account_ledger_id_seq, public.audit_events_id_seq
  FROM anon, authenticated;
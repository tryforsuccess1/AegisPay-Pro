-- Make authenticated ownership explicit and avoid per-row auth.uid() calls.
DROP POLICY IF EXISTS users_self_select ON public.users;
CREATE POLICY users_self_select ON public.users
  FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tiers_public_read ON public.vip_tiers;
CREATE POLICY tiers_public_read ON public.vip_tiers
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS offers_public_read ON public.shop_offers;
CREATE POLICY offers_public_read ON public.shop_offers
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE INDEX IF NOT EXISTS account_ledger_actor_user_id_idx ON public.account_ledger(actor_user_id);
CREATE INDEX IF NOT EXISTS activity_logs_actor_user_id_idx ON public.activity_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS admin_adjustments_admin_user_id_idx ON public.admin_adjustments(admin_user_id);
CREATE INDEX IF NOT EXISTS admin_adjustments_user_id_idx ON public.admin_adjustments(user_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_user_id_idx ON public.audit_events(actor_user_id);
CREATE INDEX IF NOT EXISTS audit_events_target_user_id_idx ON public.audit_events(target_user_id);
CREATE INDEX IF NOT EXISTS cycle_runs_tier_id_idx ON public.cycle_runs(tier_id);
CREATE INDEX IF NOT EXISTS deposit_submissions_tier_id_idx ON public.deposit_submissions(tier_id);
CREATE INDEX IF NOT EXISTS kyc_verifications_reviewed_by_idx ON public.kyc_verifications(reviewed_by);
CREATE INDEX IF NOT EXISTS referrals_referred_user_id_idx ON public.referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS shop_offers_tier_min_id_idx ON public.shop_offers(tier_min_id);
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON public.users(referred_by);
CREATE INDEX IF NOT EXISTS withdrawal_requests_approved_by_idx ON public.withdrawal_requests(approved_by);

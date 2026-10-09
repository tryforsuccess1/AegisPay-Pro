-- Block PostgreSQL numeric special values from all persisted money and balance fields.
-- PostgreSQL sorts numeric NaN above ordinary values, so checks such as amount > 0
-- do not reject NaN. These constraints protect both RPC writes and service-role writes.
ALTER TABLE public.account_ledger
  ADD CONSTRAINT account_ledger_amount_finite_chk
  CHECK (amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.admin_adjustments
  ADD CONSTRAINT admin_adjustments_amount_finite_chk
  CHECK (amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.cycle_runs
  ADD CONSTRAINT cycle_runs_cycle_base_finite_chk
  CHECK (cycle_base NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.cycle_runs
  ADD CONSTRAINT cycle_runs_profit_amount_finite_chk
  CHECK (profit_amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.deposit_submissions
  ADD CONSTRAINT deposit_submissions_gross_amount_finite_chk
  CHECK (gross_amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.deposit_submissions
  ADD CONSTRAINT deposit_submissions_deposit_fee_finite_chk
  CHECK (deposit_fee NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.deposit_submissions
  ADD CONSTRAINT deposit_submissions_credited_amount_finite_chk
  CHECK (credited_amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_platform_reward_finite_chk
  CHECK (platform_reward NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.shop_offers
  ADD CONSTRAINT shop_offers_task_weight_finite_chk
  CHECK (task_weight NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_reward_finite_chk
  CHECK (reward NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_value_finite_chk
  CHECK (task_value NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.users
  ADD CONSTRAINT users_current_platform_balance_finite_chk
  CHECK (current_platform_balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.users
  ADD CONSTRAINT users_principal_balance_finite_chk
  CHECK (principal_balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.users
  ADD CONSTRAINT users_profit_balance_finite_chk
  CHECK (profit_balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.users
  ADD CONSTRAINT users_manual_credit_balance_finite_chk
  CHECK (manual_credit_balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.users
  ADD CONSTRAINT users_withdrawal_held_finite_chk
  CHECK (withdrawal_held NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.vip_tiers
  ADD CONSTRAINT vip_tiers_deposit_amount_finite_chk
  CHECK (deposit_amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.vip_tiers
  ADD CONSTRAINT vip_tiers_initial_profit_finite_chk
  CHECK (initial_profit NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_amount_finite_chk
  CHECK (amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_fee_amount_finite_chk
  CHECK (fee_amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;
ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_net_amount_finite_chk
  CHECK (net_amount NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) NOT VALID;

ALTER TABLE public.account_ledger VALIDATE CONSTRAINT account_ledger_amount_finite_chk;
ALTER TABLE public.admin_adjustments VALIDATE CONSTRAINT admin_adjustments_amount_finite_chk;
ALTER TABLE public.cycle_runs VALIDATE CONSTRAINT cycle_runs_cycle_base_finite_chk;
ALTER TABLE public.cycle_runs VALIDATE CONSTRAINT cycle_runs_profit_amount_finite_chk;
ALTER TABLE public.deposit_submissions VALIDATE CONSTRAINT deposit_submissions_gross_amount_finite_chk;
ALTER TABLE public.deposit_submissions VALIDATE CONSTRAINT deposit_submissions_deposit_fee_finite_chk;
ALTER TABLE public.deposit_submissions VALIDATE CONSTRAINT deposit_submissions_credited_amount_finite_chk;
ALTER TABLE public.referrals VALIDATE CONSTRAINT referrals_platform_reward_finite_chk;
ALTER TABLE public.shop_offers VALIDATE CONSTRAINT shop_offers_task_weight_finite_chk;
ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_reward_finite_chk;
ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_task_value_finite_chk;
ALTER TABLE public.users VALIDATE CONSTRAINT users_current_platform_balance_finite_chk;
ALTER TABLE public.users VALIDATE CONSTRAINT users_principal_balance_finite_chk;
ALTER TABLE public.users VALIDATE CONSTRAINT users_profit_balance_finite_chk;
ALTER TABLE public.users VALIDATE CONSTRAINT users_manual_credit_balance_finite_chk;
ALTER TABLE public.users VALIDATE CONSTRAINT users_withdrawal_held_finite_chk;
ALTER TABLE public.vip_tiers VALIDATE CONSTRAINT vip_tiers_deposit_amount_finite_chk;
ALTER TABLE public.vip_tiers VALIDATE CONSTRAINT vip_tiers_initial_profit_finite_chk;
ALTER TABLE public.withdrawal_requests VALIDATE CONSTRAINT withdrawal_requests_amount_finite_chk;
ALTER TABLE public.withdrawal_requests VALIDATE CONSTRAINT withdrawal_requests_fee_amount_finite_chk;
ALTER TABLE public.withdrawal_requests VALIDATE CONSTRAINT withdrawal_requests_net_amount_finite_chk;

-- Phase 1 audit hardening: cover the two foreign keys reported by the live
-- Supabase performance advisor. Safe additive indexes; no financial rows changed.
BEGIN;

CREATE INDEX IF NOT EXISTS ai_support_cases_representative_user_id_idx
  ON public.ai_support_cases (representative_user_id);

CREATE INDEX IF NOT EXISTS ai_support_messages_sender_user_id_idx
  ON public.ai_support_messages (sender_user_id);

COMMENT ON INDEX public.ai_support_cases_representative_user_id_idx IS
  'Covers representative_user_id foreign key; added after Supabase performance advisor finding.';
COMMENT ON INDEX public.ai_support_messages_sender_user_id_idx IS
  'Covers sender_user_id foreign key; added after Supabase performance advisor finding.';

COMMIT;

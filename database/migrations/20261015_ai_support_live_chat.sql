-- Secure live customer-representative chat on top of existing AegisPay AI support cases.
ALTER TABLE public.ai_support_cases
  ADD COLUMN IF NOT EXISTS representative_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS representative_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS representative_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_seeded_at timestamptz;

-- Upgrade still-open representative tickets created before live-chat messages were introduced.
UPDATE public.ai_support_cases
SET representative_requested = true
WHERE status IN ('OPEN','IN_PROGRESS')
  AND ai_answer ILIKE 'Client requested a customer representative%';

CREATE INDEX IF NOT EXISTS ai_support_cases_live_rep_idx
  ON public.ai_support_cases (user_id, updated_at DESC)
  WHERE representative_requested = true AND status IN ('OPEN','IN_PROGRESS');

CREATE TABLE IF NOT EXISTS public.ai_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.ai_support_cases(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('CLIENT','AI','REPRESENTATIVE','SYSTEM')),
  message_text text NOT NULL CHECK (char_length(trim(message_text)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_support_messages_case_created_idx
  ON public.ai_support_messages (case_id, created_at ASC, id ASC);

ALTER TABLE public.ai_support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_support_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_support_messages TO service_role;

COMMENT ON TABLE public.ai_support_messages IS
  'Private AI support conversation transcript. Read/write only through the authenticated ai-support Edge Function.';
COMMENT ON COLUMN public.ai_support_cases.representative_joined_at IS
  'When an authorized representative entered the same client-facing AI support conversation.';

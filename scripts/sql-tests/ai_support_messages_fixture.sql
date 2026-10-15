-- Disposable fixture for the AI support message client-access posture.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.ai_support_messages (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  sender_user_id uuid,
  sender_role text NOT NULL,
  message_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_support_messages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_support_messages TO service_role;
ALTER TABLE public.ai_support_messages ENABLE ROW LEVEL SECURITY;

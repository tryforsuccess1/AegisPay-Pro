-- Index the nullable resolver foreign key to keep user deletes/updates from scanning ai_support_cases.
CREATE INDEX IF NOT EXISTS ai_support_cases_resolved_by_idx
  ON public.ai_support_cases (resolved_by);

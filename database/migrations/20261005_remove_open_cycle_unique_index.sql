-- Keep automatic task-cycle creation compatible with existing multi-deposit behavior.
-- The auto-cycle function already guards against an existing open/waiting cycle,
-- so a database-wide unique partial index is not required here.
DROP INDEX IF EXISTS public.cycle_runs_one_open_cycle_per_user_idx;
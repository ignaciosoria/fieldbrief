-- Soft follow-up window (this_week | next_week | in_2_weeks) when no fixed calendar date.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS next_step_soft_timing text;

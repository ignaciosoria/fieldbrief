-- Follow-up opportunity strength (soft | medium | hard) when primary is follow_up.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS follow_up_strength text;

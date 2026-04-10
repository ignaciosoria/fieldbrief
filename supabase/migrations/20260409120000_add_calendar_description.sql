-- Scannable calendar prep lines (→ bullets) from structure API
ALTER TABLE notes ADD COLUMN IF NOT EXISTS calendar_description text;

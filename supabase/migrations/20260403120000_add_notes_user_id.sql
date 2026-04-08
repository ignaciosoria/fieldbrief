-- Associate notes with the signed-in user (Google account email).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id text;

CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id);

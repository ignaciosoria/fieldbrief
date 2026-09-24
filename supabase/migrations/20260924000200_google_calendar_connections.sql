BEGIN;
CREATE TABLE public.google_calendar_connections (
  user_id text PRIMARY KEY CHECK (user_id = lower(btrim(user_id)) AND user_id <> ''),
  google_subject text NOT NULL,
  access_encrypted text NOT NULL,
  refresh_encrypted text,
  scope text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_calendar_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_connections TO service_role;
COMMIT;

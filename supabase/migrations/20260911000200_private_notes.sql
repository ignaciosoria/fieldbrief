BEGIN;
CREATE TABLE public.folup_notes (
  user_id text NOT NULL,
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  raw_text text NOT NULL,
  structured_output jsonb NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX folup_notes_history ON public.folup_notes (user_id, created_at DESC, id DESC);
ALTER TABLE public.folup_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folup_notes FROM anon, authenticated;
GRANT ALL ON public.folup_notes TO service_role;
-- Remove legacy browser access without deleting data. All new access goes through server routes.
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notes FROM anon, authenticated;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
COMMIT;

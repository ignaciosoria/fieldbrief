BEGIN;
-- Block concurrent writes during baseline capture and trigger installation.
LOCK TABLE public.folup_notes IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.folup_note_revisions (
  user_id text NOT NULL,
  note_id uuid NOT NULL,
  revision_id uuid NOT NULL DEFAULT gen_random_uuid(),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  parent_revision_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  note_created_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('baseline','created','updated')),
  raw_text text NOT NULL,
  structured_output jsonb NOT NULL,
  PRIMARY KEY (user_id, note_id, revision_id),
  UNIQUE (user_id, note_id, revision_number),
  FOREIGN KEY (user_id, note_id) REFERENCES public.folup_notes(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, note_id, parent_revision_id)
    REFERENCES public.folup_note_revisions(user_id,note_id,revision_id)
    DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.folup_note_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folup_note_revisions FROM PUBLIC, anon, authenticated, service_role;
-- Only the trigger may append snapshots. Deleting the owning note erases them.
GRANT SELECT ON public.folup_note_revisions TO service_role;

INSERT INTO public.folup_note_revisions
  (user_id,note_id,revision_number,note_created_at,source,raw_text,structured_output)
SELECT user_id,id,1,created_at,'baseline',raw_text,structured_output
FROM public.folup_notes;

CREATE FUNCTION public.capture_folup_note_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous public.folup_note_revisions%ROWTYPE;
BEGIN
  -- Postgres holds the note row lock through this AFTER trigger. Updates of a
  -- single note are serialized, so two writers cannot allocate the same number.
  -- A retry of the current snapshot is not another semantic revision.
  IF TG_OP = 'UPDATE' AND OLD.raw_text IS NOT DISTINCT FROM NEW.raw_text
    AND OLD.structured_output IS NOT DISTINCT FROM NEW.structured_output THEN
    RETURN NEW;
  END IF;
  SELECT * INTO previous FROM public.folup_note_revisions
    WHERE user_id=NEW.user_id AND note_id=NEW.id ORDER BY revision_number DESC LIMIT 1;
  INSERT INTO public.folup_note_revisions
    (user_id,note_id,revision_number,parent_revision_id,note_created_at,source,raw_text,structured_output)
  VALUES (NEW.user_id,NEW.id,coalesce(previous.revision_number,0)+1,previous.revision_id,
    NEW.created_at,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,
    NEW.raw_text,NEW.structured_output);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_folup_note_revision() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER folup_note_revision_capture
AFTER INSERT OR UPDATE OF raw_text,structured_output ON public.folup_notes
FOR EACH ROW EXECUTE FUNCTION public.capture_folup_note_revision();
COMMIT;

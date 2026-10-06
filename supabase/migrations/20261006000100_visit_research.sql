BEGIN;
CREATE TABLE public.folup_visit_research (
 user_id text NOT NULL,note_id uuid NOT NULL,note_version integer NOT NULL,
 state text NOT NULL CHECK(state IN ('running','done','failed')),
 attempt uuid NOT NULL,attempts integer NOT NULL DEFAULT 1,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),result jsonb,
 PRIMARY KEY(user_id,note_id,note_version),
 FOREIGN KEY(user_id,note_id) REFERENCES public.folup_notes(user_id,id) ON DELETE CASCADE
);
ALTER TABLE public.folup_visit_research ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folup_visit_research FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.folup_visit_research TO service_role;
CREATE FUNCTION public.claim_folup_research(p_owner text,p_note uuid,p_version integer,p_attempt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.folup_notes WHERE user_id=p_owner AND id=p_note AND version=p_version FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.folup_visit_research(user_id,note_id,note_version,state,attempt)
 VALUES(p_owner,p_note,p_version,'running',p_attempt)
 ON CONFLICT(user_id,note_id,note_version) DO UPDATE
 SET state='running',attempt=p_attempt,started_at=clock_timestamp(),attempts=folup_visit_research.attempts+1
 WHERE folup_visit_research.attempts<3 AND (folup_visit_research.state='failed' OR
 (folup_visit_research.state='running' AND folup_visit_research.started_at<clock_timestamp()-interval '2 minutes'));
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_folup_research(text,uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_folup_research(text,uuid,integer,uuid) TO service_role;
COMMIT;

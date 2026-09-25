BEGIN;
ALTER TABLE public.folup_notes ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE TABLE public.folup_note_writes (
 user_id text NOT NULL,note_id uuid NOT NULL,request_id uuid NOT NULL,
 expected_version integer NOT NULL, saved_version integer NOT NULL,
 raw_text text NOT NULL, structured_output jsonb NOT NULL,
 PRIMARY KEY(user_id,note_id,request_id),
 FOREIGN KEY(user_id,note_id) REFERENCES public.folup_notes(user_id,id) ON DELETE CASCADE
);
ALTER TABLE public.folup_note_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folup_note_writes FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_folup_note(p_user_id text,p_note_id uuid,p_request_id uuid,p_expected_version integer,p_raw_text text,p_output jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.folup_notes%ROWTYPE; w public.folup_note_writes%ROWTYPE; v integer; trial_key text;
BEGIN
 IF p_expected_version IS NULL OR p_expected_version<0 OR p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid write'; END IF;
 -- Also serialize competing creates, where no note row exists yet.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id||':'||p_note_id::text,0));
 SELECT * INTO n FROM public.folup_notes WHERE user_id=p_user_id AND id=p_note_id FOR UPDATE;
 SELECT * INTO w FROM public.folup_note_writes WHERE user_id=p_user_id AND note_id=p_note_id AND request_id=p_request_id;
 IF FOUND THEN
   IF w.expected_version<>p_expected_version OR w.raw_text IS DISTINCT FROM p_raw_text OR w.structured_output IS DISTINCT FROM p_output
   THEN RETURN jsonb_build_object('error','request_reused'); END IF;
   IF n.version IS DISTINCT FROM w.saved_version THEN RETURN jsonb_build_object('error','conflict'); END IF;
   RETURN jsonb_build_object('saved',true,'version',w.saved_version);
 END IF;
 IF coalesce(n.version,0)<>p_expected_version THEN RETURN jsonb_build_object('error','conflict'); END IF;
 trial_key:=p_output->>'trialNoteKey';
 IF trial_key IS NOT NULL THEN
   IF trial_key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid trial key'; END IF;
   IF NOT public.bind_trial_note(p_user_id,trial_key,p_note_id) THEN RETURN jsonb_build_object('error','trial_bound'); END IF;
 END IF;
 v:=coalesce(n.version,0)+1;
 INSERT INTO public.folup_notes(user_id,id,raw_text,structured_output,version)
 VALUES(p_user_id,p_note_id,p_raw_text,p_output,v)
 ON CONFLICT(user_id,id) DO UPDATE SET raw_text=excluded.raw_text,structured_output=excluded.structured_output,version=excluded.version;
 INSERT INTO public.folup_note_writes VALUES(p_user_id,p_note_id,p_request_id,p_expected_version,v,p_raw_text,p_output);
 RETURN jsonb_build_object('saved',true,'version',v);
END;
$$;
REVOKE ALL ON FUNCTION public.save_folup_note(text,uuid,uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_folup_note(text,uuid,uuid,integer,text,jsonb) TO service_role;
-- Prevent old application instances from bypassing version checks.
REVOKE INSERT,UPDATE ON public.folup_notes FROM service_role;
COMMIT;

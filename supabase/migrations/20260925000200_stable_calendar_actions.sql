BEGIN;
LOCK TABLE public.folup_notes IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.folup_actions (
 user_id text NOT NULL, note_id uuid NOT NULL, action_id uuid NOT NULL DEFAULT gen_random_uuid(),
 action_index integer NOT NULL, snapshot jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
 legacy_index integer, needs_review boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,note_id,action_id),
 FOREIGN KEY(user_id,note_id) REFERENCES public.folup_notes(user_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX folup_actions_active_index ON public.folup_actions(user_id,note_id,action_index) WHERE active;
CREATE TABLE public.folup_calendar_links (
 user_id text NOT NULL,note_id uuid NOT NULL,action_id uuid NOT NULL,
 event_id text NOT NULL,calendar_id text NOT NULL DEFAULT 'primary' CHECK(calendar_id='primary'),
 draft jsonb NOT NULL,source_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','saved')),
 event_url text,created_at timestamptz NOT NULL DEFAULT now(),saved_at timestamptz,
 PRIMARY KEY(user_id,note_id,action_id),UNIQUE(user_id,event_id),
 FOREIGN KEY(user_id,note_id,action_id) REFERENCES public.folup_actions(user_id,note_id,action_id) ON DELETE CASCADE
);
ALTER TABLE public.folup_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folup_calendar_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folup_actions,public.folup_calendar_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.folup_actions,public.folup_calendar_links TO service_role;

CREATE FUNCTION public.folup_action_identity(a jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT a - ARRAY['date','time','daypart','evidence','rationale','timingReason'];
$$;
REVOKE ALL ON FUNCTION public.folup_action_identity(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.sync_folup_actions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE incoming jsonb; item jsonb; previous jsonb; candidate jsonb; matched uuid[]:='{}';
 new_ids uuid[]:='{}'; chosen uuid; idx integer:=0; ambiguous boolean:=false;
BEGIN
 IF TG_OP='UPDATE' AND OLD.structured_output->'extraction'->'actions' IS NOT DISTINCT FROM NEW.structured_output->'extraction'->'actions' THEN RETURN NEW; END IF;
 incoming:=NEW.structured_output->'extraction'->'actions';
 IF jsonb_typeof(incoming) IS DISTINCT FROM 'array' THEN incoming:='[]'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO previous FROM public.folup_actions a
 WHERE user_id=NEW.user_id AND note_id=NEW.id AND active;
 UPDATE public.folup_actions SET active=false WHERE user_id=NEW.user_id AND note_id=NEW.id AND active;
 FOR item IN SELECT value FROM jsonb_array_elements(incoming) LOOP
   candidate:=NULL;
   IF (SELECT count(*) FROM jsonb_array_elements(incoming) x WHERE public.folup_action_identity(x.value)=public.folup_action_identity(item))=1
     AND (SELECT count(*) FROM jsonb_array_elements(previous) x WHERE public.folup_action_identity(x.value->'snapshot')=public.folup_action_identity(item))=1 THEN
     SELECT value INTO candidate FROM jsonb_array_elements(previous) x
       WHERE public.folup_action_identity(x.value->'snapshot')=public.folup_action_identity(item);
   END IF;
   IF candidate IS NOT NULL THEN
     chosen:=(candidate->>'action_id')::uuid;
     UPDATE public.folup_actions SET active=true,action_index=idx,snapshot=item
       WHERE user_id=NEW.user_id AND note_id=NEW.id AND action_id=chosen;
     matched:=array_append(matched,chosen);
   ELSE
     INSERT INTO public.folup_actions(user_id,note_id,action_index,snapshot)
       VALUES(NEW.user_id,NEW.id,idx,item) RETURNING action_id INTO chosen;
     new_ids:=array_append(new_ids,chosen);
   END IF;
   idx:=idx+1;
 END LOOP;
 -- Never automatically create a replacement for an unrecognisable task that
 -- may already have an event (including an ambiguous network write).
 SELECT EXISTS(SELECT 1 FROM public.folup_actions a WHERE a.user_id=NEW.user_id AND a.note_id=NEW.id
   AND NOT a.active AND (a.legacy_index IS NOT NULL OR a.needs_review OR EXISTS(
     SELECT 1 FROM public.folup_calendar_links l WHERE l.user_id=a.user_id AND l.note_id=a.note_id AND l.action_id=a.action_id))) INTO ambiguous;
 IF ambiguous THEN UPDATE public.folup_actions SET needs_review=true
   WHERE user_id=NEW.user_id AND note_id=NEW.id AND action_id=ANY(new_ids); END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_folup_actions() FROM PUBLIC,anon,authenticated,service_role;
-- Preserve the old Google event addressing for existing notes only.
INSERT INTO public.folup_actions(user_id,note_id,action_index,snapshot,legacy_index)
 SELECT n.user_id,n.id,(a.ordinality-1)::integer,a.value,(a.ordinality-1)::integer
 FROM public.folup_notes n CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(n.structured_output->'extraction'->'actions')='array'
 THEN n.structured_output->'extraction'->'actions' ELSE '[]'::jsonb END) WITH ORDINALITY a;
CREATE TRIGGER folup_actions_sync AFTER INSERT OR UPDATE OF structured_output ON public.folup_notes
 FOR EACH ROW EXECUTE FUNCTION public.sync_folup_actions();

CREATE FUNCTION public.reserve_folup_calendar(p_user_id text,p_note_id uuid,p_action_id uuid,p_snapshot jsonb,p_draft jsonb,p_event_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.folup_actions%ROWTYPE;l public.folup_calendar_links%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.folup_notes WHERE user_id=p_user_id AND id=p_note_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','stale'); END IF;
 SELECT * INTO a FROM public.folup_actions WHERE user_id=p_user_id AND note_id=p_note_id AND action_id=p_action_id AND active;
 IF NOT FOUND OR a.snapshot IS DISTINCT FROM p_snapshot THEN RETURN jsonb_build_object('error','stale'); END IF;
 IF a.needs_review THEN RETURN jsonb_build_object('error','review'); END IF;
 INSERT INTO public.folup_calendar_links(user_id,note_id,action_id,event_id,draft,source_snapshot)
 VALUES(p_user_id,p_note_id,p_action_id,p_event_id,p_draft,p_snapshot) ON CONFLICT DO NOTHING;
 SELECT * INTO l FROM public.folup_calendar_links WHERE user_id=p_user_id AND note_id=p_note_id AND action_id=p_action_id;
 IF l.source_snapshot IS DISTINCT FROM p_snapshot OR l.draft IS DISTINCT FROM p_draft
 THEN RETURN jsonb_build_object('error','changed','url',l.event_url); END IF;
 RETURN to_jsonb(l);
END;
$$;
CREATE FUNCTION public.confirm_folup_calendar(p_user_id text,p_note_id uuid,p_action_id uuid,p_event_id text,p_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.folup_calendar_links SET status='saved',event_url=p_url,saved_at=coalesce(saved_at,clock_timestamp())
 WHERE user_id=p_user_id AND note_id=p_note_id AND action_id=p_action_id AND event_id=p_event_id;
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_folup_calendar(text,uuid,uuid,jsonb,jsonb,text),public.confirm_folup_calendar(text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_folup_calendar(text,uuid,uuid,jsonb,jsonb,text),public.confirm_folup_calendar(text,uuid,uuid,text,text) TO service_role;
COMMIT;

BEGIN;
LOCK TABLE public.folup_notes IN SHARE ROW EXCLUSIVE MODE;

-- UUIDs are identity; labels are evidence/candidates, never unique identity keys.
CREATE TABLE public.folup_entities (
 user_id text NOT NULL, entity_id uuid NOT NULL DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('contact','company')), label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,entity_id), UNIQUE(user_id,entity_id,kind)
);
CREATE TABLE public.folup_entity_mentions (
 user_id text NOT NULL,note_id uuid NOT NULL,revision_id uuid NOT NULL,
 mention_id uuid NOT NULL DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('contact','company')),
 source text NOT NULL CHECK(source IN ('header','action')), source_index integer NOT NULL,
 label text NOT NULL,normalized_label text NOT NULL,
 company_context text NOT NULL DEFAULT '', evidence text NOT NULL DEFAULT '',
 action_origin text NOT NULL DEFAULT '', uncertain boolean NOT NULL DEFAULT false,
 entity_id uuid,confirmed_at timestamptz,
 PRIMARY KEY(user_id,mention_id),
 UNIQUE(user_id,note_id,revision_id,kind,source,source_index),
 FOREIGN KEY(user_id,note_id,revision_id) REFERENCES public.folup_note_revisions(user_id,note_id,revision_id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,entity_id,kind) REFERENCES public.folup_entities(user_id,entity_id,kind),
 CHECK((entity_id IS NULL)=(confirmed_at IS NULL))
);
CREATE INDEX folup_entity_mentions_lookup ON public.folup_entity_mentions(user_id,kind,normalized_label);
CREATE INDEX folup_entity_mentions_entity ON public.folup_entity_mentions(user_id,entity_id);
ALTER TABLE public.folup_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folup_entity_mentions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folup_entities,public.folup_entity_mentions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.folup_entities,public.folup_entity_mentions TO service_role;

CREATE FUNCTION public.folup_entity_label(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT lower(btrim(regexp_replace(t,'[[:space:]]+',' ','g')));
$$;
REVOKE ALL ON FUNCTION public.folup_entity_label(text) FROM PUBLIC,anon,authenticated;

-- Capture only structured identity slots. Never mine summary/insights for names.
-- An action's company is context, NOT proof of employment or attendance.
CREATE FUNCTION public.capture_folup_entity_mentions(p_owner text,p_note uuid,p_revision uuid,p_output jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ex jsonb:=p_output->'extraction'; qs jsonb; actions jsonb; item jsonb; idx integer; k text; labels jsonb; name text;
BEGIN
 IF jsonb_typeof(ex) IS DISTINCT FROM 'object' THEN RETURN; END IF;
 qs:=CASE WHEN jsonb_typeof(ex->'questions')='array' THEN ex->'questions' ELSE '[]'::jsonb END;
 FOREACH k IN ARRAY ARRAY['contact','company'] LOOP
   labels:=ex->(CASE WHEN k='contact' THEN 'contacts' ELSE 'companies' END);
   IF jsonb_typeof(labels)='array' THEN
     idx:=0;
     FOR item IN SELECT value FROM jsonb_array_elements(labels) LOOP
       IF jsonb_typeof(item)='string' THEN
         name:=item#>>'{}';
         IF length(btrim(name)) BETWEEN 1 AND 300 THEN
           INSERT INTO public.folup_entity_mentions(user_id,note_id,revision_id,kind,source,source_index,label,normalized_label,uncertain)
           VALUES(p_owner,p_note,p_revision,k,'header',idx,name,public.folup_entity_label(name),
             EXISTS(SELECT 1 FROM jsonb_array_elements(qs) q WHERE q.value->>'field'=k)) ON CONFLICT DO NOTHING;
         END IF;
       END IF;
       idx:=idx+1;
     END LOOP;
   END IF;
 END LOOP;
 actions:=CASE WHEN jsonb_typeof(ex->'actions')='array' THEN ex->'actions' ELSE '[]'::jsonb END;
 idx:=0;
 FOR item IN SELECT value FROM jsonb_array_elements(actions) LOOP
   FOREACH k IN ARRAY ARRAY['contact','company'] LOOP
     IF jsonb_typeof(item->k)='string' THEN
       name:=item->>k;
       IF length(btrim(name)) BETWEEN 1 AND 300 THEN
         INSERT INTO public.folup_entity_mentions(user_id,note_id,revision_id,kind,source,source_index,label,normalized_label,company_context,evidence,action_origin,uncertain)
         VALUES(p_owner,p_note,p_revision,k,'action',idx,name,public.folup_entity_label(name),
           CASE WHEN jsonb_typeof(item->'company')='string' THEN item->>'company' ELSE '' END,
           CASE WHEN jsonb_typeof(item->'evidence')='string' THEN item->>'evidence' ELSE '' END,
           CASE WHEN jsonb_typeof(item->'origin')='string' THEN item->>'origin' ELSE '' END,
           EXISTS(SELECT 1 FROM jsonb_array_elements(qs) q WHERE q.value->>'field'=k AND q.value->>'action_index' IN ('-1',idx::text))) ON CONFLICT DO NOTHING;
       END IF;
     END IF;
   END LOOP;
   idx:=idx+1;
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_folup_entity_mentions(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sync_folup_entity_mentions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rev uuid;
BEGIN
 IF TG_OP='UPDATE' AND OLD.raw_text IS NOT DISTINCT FROM NEW.raw_text AND OLD.structured_output IS NOT DISTINCT FROM NEW.structured_output THEN RETURN NEW; END IF;
 SELECT revision_id INTO rev FROM public.folup_note_revisions WHERE user_id=NEW.user_id AND note_id=NEW.id ORDER BY revision_number DESC LIMIT 1;
 IF rev IS NULL THEN RAISE EXCEPTION 'Missing note revision'; END IF;
 PERFORM public.capture_folup_entity_mentions(NEW.user_id,NEW.id,rev,NEW.structured_output);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_folup_entity_mentions() FROM PUBLIC,anon,authenticated,service_role;
-- PostgreSQL fires same-kind triggers alphabetically: run AFTER revision capture.
CREATE TRIGGER z_folup_entity_mentions_capture AFTER INSERT OR UPDATE OF raw_text,structured_output ON public.folup_notes
FOR EACH ROW EXECUTE FUNCTION public.sync_folup_entity_mentions();

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT user_id,note_id,revision_id,structured_output FROM public.folup_note_revisions LOOP
   PERFORM public.capture_folup_entity_mentions(r.user_id,r.note_id,r.revision_id,r.structured_output);
 END LOOP;
END $$;

-- This is an explicit-confirmation primitive, not an automatic resolver. No public
-- endpoint/UI calls it yet. NULL target means the user confirmed a NEW identity.
CREATE FUNCTION public.confirm_folup_entity(p_owner text,p_mention uuid,p_entity uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.folup_entity_mentions%ROWTYPE; latest uuid; target uuid; note uuid;
BEGIN
 SELECT note_id INTO note FROM public.folup_entity_mentions WHERE user_id=p_owner AND mention_id=p_mention;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','missing'); END IF;
 PERFORM 1 FROM public.folup_notes WHERE user_id=p_owner AND id=note FOR UPDATE;
 SELECT * INTO m FROM public.folup_entity_mentions WHERE user_id=p_owner AND mention_id=p_mention FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','missing'); END IF;
 SELECT revision_id INTO latest FROM public.folup_note_revisions WHERE user_id=p_owner AND note_id=m.note_id ORDER BY revision_number DESC LIMIT 1;
 IF latest IS DISTINCT FROM m.revision_id THEN RETURN jsonb_build_object('error','stale'); END IF;
 IF m.uncertain THEN RETURN jsonb_build_object('error','uncertain'); END IF;
 IF m.entity_id IS NOT NULL THEN
   IF p_entity IS NULL OR p_entity=m.entity_id THEN RETURN jsonb_build_object('entityId',m.entity_id); END IF;
   RETURN jsonb_build_object('error','already_confirmed');
 END IF;
 IF p_entity IS NOT NULL THEN
   SELECT entity_id INTO target FROM public.folup_entities WHERE user_id=p_owner AND entity_id=p_entity AND kind=m.kind;
   IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_target'); END IF;
 ELSE
   INSERT INTO public.folup_entities(user_id,kind,label) VALUES(p_owner,m.kind,m.label) RETURNING entity_id INTO target;
 END IF;
 UPDATE public.folup_entity_mentions SET entity_id=target,confirmed_at=clock_timestamp() WHERE user_id=p_owner AND mention_id=p_mention;
 RETURN jsonb_build_object('entityId',target);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_folup_entity(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_folup_entity(text,uuid,uuid) TO service_role;

-- Exact normalized labels/explicitly confirmed aliases are only candidates.
-- No accent removal, fuzzy matching, suffix stripping or inferred affiliation.
CREATE FUNCTION public.folup_entity_candidates(p_owner text,p_mention uuid)
RETURNS TABLE(entity_id uuid,label text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT e.entity_id,e.label FROM public.folup_entity_mentions m
 JOIN public.folup_entities e ON e.user_id=m.user_id AND e.kind=m.kind
 WHERE m.user_id=p_owner AND m.mention_id=p_mention AND NOT m.uncertain
 AND (public.folup_entity_label(e.label)=m.normalized_label OR EXISTS(
   SELECT 1 FROM public.folup_entity_mentions a WHERE a.user_id=e.user_id AND a.entity_id=e.entity_id AND a.normalized_label=m.normalized_label))
 ORDER BY e.entity_id;
$$;
REVOKE ALL ON FUNCTION public.folup_entity_candidates(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.folup_entity_candidates(text,uuid) TO service_role;

-- Deleting the last supporting note must not retain its private names forever.
CREATE FUNCTION public.prune_folup_entity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.entity_id IS NOT NULL THEN
   DELETE FROM public.folup_entities e WHERE e.user_id=OLD.user_id AND e.entity_id=OLD.entity_id
   AND NOT EXISTS(SELECT 1 FROM public.folup_entity_mentions m WHERE m.user_id=e.user_id AND m.entity_id=e.entity_id);
 END IF;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_folup_entity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER folup_entity_orphan_cleanup AFTER DELETE ON public.folup_entity_mentions FOR EACH ROW EXECUTE FUNCTION public.prune_folup_entity();
COMMIT;

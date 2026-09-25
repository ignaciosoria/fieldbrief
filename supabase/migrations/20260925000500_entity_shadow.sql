BEGIN;
CREATE TABLE public.folup_entity_shadow (
 user_id text NOT NULL,mention_id uuid NOT NULL,algorithm text NOT NULL DEFAULT 'exact-context-v1',
 decision text NOT NULL CHECK(decision IN ('review','abstain')),reason text NOT NULL,
 evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),candidate_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,mention_id,algorithm),
 FOREIGN KEY(user_id,mention_id) REFERENCES public.folup_entity_mentions(user_id,mention_id) ON DELETE CASCADE
);
CREATE TABLE public.folup_entity_shadow_candidates (
 user_id text NOT NULL,mention_id uuid NOT NULL,algorithm text NOT NULL,
 candidate_mention_id uuid NOT NULL,context_match boolean NOT NULL,
 PRIMARY KEY(user_id,mention_id,algorithm,candidate_mention_id),
 FOREIGN KEY(user_id,mention_id,algorithm) REFERENCES public.folup_entity_shadow(user_id,mention_id,algorithm) ON DELETE CASCADE,
 FOREIGN KEY(user_id,candidate_mention_id) REFERENCES public.folup_entity_mentions(user_id,mention_id) ON DELETE CASCADE
);
ALTER TABLE public.folup_entity_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folup_entity_shadow_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folup_entity_shadow,public.folup_entity_shadow_candidates FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.folup_entity_shadow,public.folup_entity_shadow_candidates TO service_role;

CREATE FUNCTION public.folup_shadow_literal(raw_text text,label text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT length(public.folup_entity_label(label))>0 AND strpos(
   ' '||btrim(regexp_replace(public.folup_entity_label(raw_text),'[^[:alnum:]]+',' ','g'))||' ',
   ' '||btrim(regexp_replace(public.folup_entity_label(label),'[^[:alnum:]]+',' ','g'))||' ')>0;
$$;
REVOKE ALL ON FUNCTION public.folup_shadow_literal(text,text) FROM PUBLIC,anon,authenticated;

-- Shadow-only: never writes entities, confirmations, notes or commercial output.
CREATE FUNCTION public.evaluate_folup_entity_shadow(p_owner text,p_note uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rev uuid; cutoff timestamptz; m record; c record; v_reason text; v_decision text;
 count_candidates integer; matches integer; evaluated integer:=0; source_context text;
BEGIN
 -- Serialize duplicate background jobs with note updates/deletions.
 PERFORM 1 FROM public.folup_notes WHERE user_id=p_owner AND id=p_note FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 SELECT revision_id,recorded_at INTO rev,cutoff FROM public.folup_note_revisions
 WHERE user_id=p_owner AND note_id=p_note ORDER BY revision_number DESC LIMIT 1;
 FOR m IN SELECT * FROM public.folup_entity_mentions WHERE user_id=p_owner AND note_id=p_note AND revision_id=rev
 ORDER BY mention_id LIMIT 128 LOOP
   IF EXISTS(SELECT 1 FROM public.folup_entity_shadow WHERE user_id=p_owner AND mention_id=m.mention_id AND algorithm='exact-context-v1') THEN CONTINUE; END IF;
   v_reason:='no_exact_history';v_decision:='abstain';count_candidates:=0;matches:=0;
   source_context:=public.folup_entity_label(m.company_context);
   IF NOT EXISTS(SELECT 1 FROM public.folup_note_revisions r WHERE r.user_id=p_owner AND r.note_id=p_note AND r.revision_id=rev
     AND public.folup_shadow_literal(r.raw_text,m.company_context)) THEN source_context:=''; END IF;
   IF EXISTS(SELECT 1 FROM public.folup_entity_mentions context_mention WHERE context_mention.user_id=p_owner
     AND context_mention.revision_id=rev AND context_mention.kind='company' AND context_mention.source=m.source
     AND context_mention.source_index=m.source_index AND context_mention.uncertain) THEN source_context:=''; END IF;
   IF m.uncertain THEN v_reason:='uncertain_identity';
   ELSIF m.kind='contact' AND m.normalized_label ~ '(^|[[:space:]])(father|mother|dad|mom|padre|madre|papa|papá|pca|advisor|asesor)([[:space:]]|$)' THEN v_reason:='relational_or_role_identity';
   ELSIF m.entity_id IS NOT NULL THEN v_reason:='already_confirmed';
   ELSIF m.action_origin='recommendation' THEN v_reason:='recommendation_not_identity_evidence';
   ELSIF NOT EXISTS(SELECT 1 FROM public.folup_note_revisions r WHERE r.user_id=p_owner AND r.note_id=p_note AND r.revision_id=rev
     AND public.folup_shadow_literal(r.raw_text,m.label)) THEN v_reason:='name_not_literal_in_source';
   ELSE
     v_reason:='eligible';
   END IF;
   INSERT INTO public.folup_entity_shadow(user_id,mention_id,decision,reason) VALUES(p_owner,m.mention_id,v_decision,v_reason);
   IF v_reason='eligible' THEN
     -- One representative per prior note, not one vote per repeated action/header.
     -- Current revision only, and never evidence recorded after the source revision.
     FOR c IN
       SELECT * FROM (
         SELECT DISTINCT ON (other.note_id) other.*,(public.folup_shadow_literal(r.raw_text,other.company_context) AND NOT EXISTS(
           SELECT 1 FROM public.folup_entity_mentions context_mention WHERE context_mention.user_id=other.user_id
             AND context_mention.revision_id=other.revision_id AND context_mention.kind='company' AND context_mention.source=other.source
             AND context_mention.source_index=other.source_index AND context_mention.uncertain)) AS context_grounded
         FROM public.folup_entity_mentions other
         JOIN public.folup_note_revisions r ON r.user_id=other.user_id AND r.note_id=other.note_id AND r.revision_id=other.revision_id
         JOIN public.folup_notes n ON n.user_id=other.user_id AND n.id=other.note_id
         JOIN public.folup_notes source_note ON source_note.user_id=p_owner AND source_note.id=p_note
         WHERE other.user_id=p_owner AND other.note_id<>p_note AND other.kind=m.kind AND other.normalized_label=m.normalized_label
           AND NOT other.uncertain AND other.action_origin<>'recommendation'
           AND r.recorded_at<=cutoff AND (n.created_at,n.id)<(source_note.created_at,source_note.id)
           AND r.revision_number=(SELECT max(rr.revision_number) FROM public.folup_note_revisions rr WHERE rr.user_id=r.user_id AND rr.note_id=r.note_id)
           AND public.folup_shadow_literal(r.raw_text,other.label)
         ORDER BY other.note_id,
           (source_context<>'' AND public.folup_entity_label(other.company_context)=source_context AND public.folup_shadow_literal(r.raw_text,other.company_context)) DESC,
           (other.source='action') DESC,other.mention_id
       ) candidates ORDER BY note_id LIMIT 21
     LOOP
       count_candidates:=count_candidates+1;
       IF count_candidates<=20 THEN
         INSERT INTO public.folup_entity_shadow_candidates(user_id,mention_id,algorithm,candidate_mention_id,context_match)
         VALUES(p_owner,m.mention_id,'exact-context-v1',c.mention_id,
           source_context<>'' AND c.context_grounded AND public.folup_entity_label(c.company_context)=source_context);
       END IF;
       IF source_context<>'' AND c.context_grounded AND public.folup_entity_label(c.company_context)=source_context THEN matches:=matches+1; END IF;
     END LOOP;
     IF count_candidates>20 THEN v_reason:='too_many_candidates';
     ELSIF count_candidates=0 THEN v_reason:='no_exact_history';
     ELSIF m.kind='company' THEN v_reason:='exact_company_name_only';v_decision:='review';
     ELSIF source_context='' THEN v_reason:='name_without_company_context';
     ELSIF matches<>count_candidates THEN v_reason:='conflicting_or_missing_company_context';
     ELSE v_reason:='exact_name_same_action_context';v_decision:='review';
     END IF;
     UPDATE public.folup_entity_shadow SET decision=v_decision,reason=v_reason,candidate_count=count_candidates
     WHERE user_id=p_owner AND mention_id=m.mention_id AND algorithm='exact-context-v1';
   END IF;
   evaluated:=evaluated+1;
 END LOOP;
 RETURN evaluated;
END;
$$;
REVOKE ALL ON FUNCTION public.evaluate_folup_entity_shadow(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_folup_entity_shadow(text,uuid) TO service_role;
COMMIT;

BEGIN;
-- Opaque bearer cookie only; no public Supabase access to guest notes.
CREATE TABLE public.folup_guest_visits (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 id uuid NOT NULL DEFAULT gen_random_uuid(), network_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 state text NOT NULL CHECK(state IN ('running','ready','failed','expired')),
 attempts integer NOT NULL DEFAULT 1, raw_text text, output jsonb, claimed_by text
);
CREATE TABLE public.folup_guest_budget(day date PRIMARY KEY, attempts integer NOT NULL DEFAULT 0);
ALTER TABLE public.folup_guest_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folup_guest_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folup_guest_visits,public.folup_guest_budget FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.folup_guest_visits TO service_role;

CREATE FUNCTION public.purge_guest_visits() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.folup_guest_visits SET raw_text=NULL,output=NULL,state='expired'
 WHERE expires_at<now() AND state<>'expired';
 DELETE FROM public.folup_guest_visits WHERE created_at<now()-interval '31 days';
 DELETE FROM public.folup_guest_budget WHERE day<current_date-31;
END $$;
REVOKE ALL ON FUNCTION public.purge_guest_visits() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_guest_visits() TO service_role;

CREATE FUNCTION public.reserve_guest_visit(p_token text,p_network text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.folup_guest_visits%ROWTYPE; total integer;
BEGIN
 -- Fixed global cap is also a cost circuit breaker; serialize all reservations.
 PERFORM pg_advisory_xact_lock(710072026);
 PERFORM public.purge_guest_visits();
 SELECT * INTO g FROM public.folup_guest_visits WHERE token_hash=p_token FOR UPDATE;
 IF FOUND THEN
   IF g.state='ready' THEN RETURN 'ready'; END IF;
   IF g.state='expired' OR g.claimed_by IS NOT NULL OR g.attempts>=2 THEN RETURN 'used'; END IF;
   IF g.state='running' THEN RETURN 'running'; END IF;
 END IF;
 INSERT INTO public.folup_guest_budget(day) VALUES(current_date) ON CONFLICT DO NOTHING;
 SELECT attempts INTO total FROM public.folup_guest_budget WHERE day=current_date FOR UPDATE;
 IF total>=100 THEN RETURN 'limited'; END IF;
 IF (SELECT coalesce(sum(attempts),0) FROM public.folup_guest_visits WHERE network_hash=p_network)>=3 THEN RETURN 'limited'; END IF;
 UPDATE public.folup_guest_budget SET attempts=attempts+1 WHERE day=current_date;
 INSERT INTO public.folup_guest_visits(token_hash,network_hash,state) VALUES(p_token,p_network,'running')
 ON CONFLICT(token_hash) DO UPDATE SET state='running',started_at=now(),attempts=folup_guest_visits.attempts+1;
 RETURN 'allowed';
END $$;
REVOKE ALL ON FUNCTION public.reserve_guest_visit(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_guest_visit(text,text) TO service_role;

CREATE FUNCTION public.claim_guest_visit(p_token text,p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.folup_guest_visits%ROWTYPE; saved jsonb;
BEGIN
 SELECT * INTO g FROM public.folup_guest_visits WHERE token_hash=p_token FOR UPDATE;
 IF NOT FOUND OR g.state<>'ready' OR g.expires_at<now() OR (g.claimed_by IS NOT NULL AND g.claimed_by<>p_email)
 THEN RETURN jsonb_build_object('error','unavailable'); END IF;
 saved:=public.save_folup_note(p_email,g.id,g.id,0,g.raw_text,g.output);
 IF saved ? 'error' THEN RETURN saved; END IF;
 UPDATE public.folup_guest_visits SET claimed_by=p_email WHERE token_hash=p_token;
 RETURN jsonb_build_object('noteId',g.id,'version',saved->'version');
END $$;
REVOKE ALL ON FUNCTION public.claim_guest_visit(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_visit(text,text) TO service_role;
COMMIT;

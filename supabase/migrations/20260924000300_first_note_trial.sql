BEGIN;
ALTER TABLE public.ai_usage ADD COLUMN trial_started_at timestamptz;
ALTER TABLE public.ai_usage ADD COLUMN trial_notes integer NOT NULL DEFAULT 0 CHECK (trial_notes >= 0 AND trial_notes <= 100);
ALTER TABLE public.ai_usage ADD COLUMN day_started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ai_usage ADD COLUMN day_count integer NOT NULL DEFAULT 0;
CREATE TABLE public.trial_note_reservations (
  user_id text NOT NULL, note_key text NOT NULL,
  token uuid NOT NULL, expires_at timestamptz NOT NULL,
  completed boolean NOT NULL DEFAULT false, saved_note_id uuid,
  PRIMARY KEY(user_id,note_key)
);
ALTER TABLE public.trial_note_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_note_reservations FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reserve_ai_usage(p_user_id text,p_operation text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.ai_usage%ROWTYPE; moment timestamptz:=clock_timestamp(); unlimited boolean;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id)='' OR p_operation IS NULL OR p_operation NOT IN ('transcribe','structure') THEN RAISE EXCEPTION 'Invalid request'; END IF;
  INSERT INTO public.ai_usage(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  SELECT * INTO u FROM public.ai_usage WHERE user_id=p_user_id FOR UPDATE;
  unlimited:=public.has_unlimited_ai_access(p_user_id);
  IF NOT unlimited AND (u.trial_notes>=100 OR moment>=u.trial_started_at+interval '14 days') THEN RETURN 'quota_exceeded'; END IF;
  IF moment>=u.window_started_at+interval '1 minute' THEN u.window_started_at:=moment;u.window_count:=0; END IF;
  IF moment>=u.day_started_at+interval '24 hours' THEN u.day_started_at:=moment;u.day_count:=0; END IF;
  IF u.window_count>=20 OR (NOT unlimited AND u.day_count>=600) THEN RETURN 'rate_limited'; END IF;
  UPDATE public.ai_usage SET window_started_at=u.window_started_at,window_count=u.window_count+1,
    day_started_at=u.day_started_at,day_count=u.day_count+1,
    transcriptions=transcriptions+CASE WHEN p_operation='transcribe' THEN 1 ELSE 0 END,
    structures=structures+CASE WHEN p_operation='structure' THEN 1 ELSE 0 END WHERE user_id=p_user_id;
  RETURN 'allowed';
END; $$;

CREATE FUNCTION public.begin_trial_note(p_user_id text,p_note_key text,p_token uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.ai_usage%ROWTYPE;r public.trial_note_reservations%ROWTYPE; moment timestamptz:=clock_timestamp();pending integer;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id)='' OR p_note_key IS NULL OR length(p_note_key)<>64 OR p_token IS NULL THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  IF public.has_unlimited_ai_access(p_user_id) THEN RETURN 'unlimited'; END IF;
  INSERT INTO public.ai_usage(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  SELECT * INTO u FROM public.ai_usage WHERE user_id=p_user_id FOR UPDATE;
  IF u.trial_notes>=100 OR moment>=u.trial_started_at+interval '14 days' THEN RETURN 'quota_exceeded'; END IF;
  SELECT * INTO r FROM public.trial_note_reservations WHERE user_id=p_user_id AND note_key=p_note_key;
  IF r.completed THEN RETURN 'completed'; END IF;
  IF r.expires_at>moment THEN RETURN 'busy'; END IF;
  SELECT count(*) INTO pending FROM public.trial_note_reservations WHERE user_id=p_user_id AND NOT completed AND expires_at>moment;
  IF u.trial_notes+pending>=100 THEN RETURN 'busy'; END IF;
  INSERT INTO public.trial_note_reservations(user_id,note_key,token,expires_at) VALUES(p_user_id,p_note_key,p_token,moment+interval '2 minutes')
    ON CONFLICT(user_id,note_key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at;
  RETURN 'reserved';
END; $$;

CREATE FUNCTION public.finish_trial_note(p_user_id text,p_note_key text,p_token uuid,p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.ai_usage%ROWTYPE;r public.trial_note_reservations%ROWTYPE;moment timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO u FROM public.ai_usage WHERE user_id=p_user_id FOR UPDATE;
  SELECT * INTO r FROM public.trial_note_reservations WHERE user_id=p_user_id AND note_key=p_note_key FOR UPDATE;
  IF r.token IS NULL OR r.token<>p_token THEN RETURN false; END IF;
  IF r.completed THEN RETURN true; END IF;
  IF NOT p_success THEN DELETE FROM public.trial_note_reservations WHERE user_id=p_user_id AND note_key=p_note_key; RETURN true; END IF;
  IF r.expires_at<=moment OR u.trial_notes>=100 OR moment>=u.trial_started_at+interval '14 days' THEN RETURN false; END IF;
  UPDATE public.ai_usage SET trial_started_at=coalesce(trial_started_at,moment),trial_notes=trial_notes+1 WHERE user_id=p_user_id;
  UPDATE public.trial_note_reservations SET completed=true WHERE user_id=p_user_id AND note_key=p_note_key;
  RETURN true;
END; $$;

CREATE FUNCTION public.get_trial_status(p_user_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('active',public.has_unlimited_ai_access(p_user_id),
   'startedAt',u.trial_started_at,'endsAt',u.trial_started_at+interval '14 days',
   'ended',coalesce(u.trial_notes>=100 OR statement_timestamp()>=u.trial_started_at+interval '14 days',false))
 FROM (SELECT 1) seed LEFT JOIN public.ai_usage u ON u.user_id=p_user_id;
$$;
CREATE FUNCTION public.bind_trial_note(p_user_id text,p_note_key text,p_note_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.trial_note_reservations SET saved_note_id=p_note_id
  WHERE user_id=p_user_id AND note_key=p_note_key AND completed AND (saved_note_id IS NULL OR saved_note_id=p_note_id);
  RETURN FOUND;
END; $$;
CREATE FUNCTION public.trial_key_for_saved_note(p_user_id text,p_note_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT note_key FROM public.trial_note_reservations WHERE user_id=p_user_id AND saved_note_id=p_note_id AND completed LIMIT 1;
$$;
CREATE FUNCTION public.trial_pending_key(p_user_id text,p_note_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT note_key FROM public.trial_note_reservations WHERE user_id=p_user_id AND note_key=p_note_key AND completed AND saved_note_id IS NULL;
$$;
REVOKE ALL ON FUNCTION public.trial_pending_key(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trial_pending_key(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.bind_trial_note(text,text,uuid),public.trial_key_for_saved_note(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_trial_note(text,text,uuid),public.trial_key_for_saved_note(text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.begin_trial_note(text,text,uuid),public.finish_trial_note(text,text,uuid,boolean),public.get_trial_status(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_trial_note(text,text,uuid),public.finish_trial_note(text,text,uuid,boolean),public.get_trial_status(text) TO service_role;
COMMIT;

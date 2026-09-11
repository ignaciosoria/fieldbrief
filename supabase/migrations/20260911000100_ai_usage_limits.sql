-- Apply BEFORE deploying the protected AI routes. Counters are attempts, not saved notes.
-- Free accounts receive 10 transcriptions + 10 structures (including corrections).
-- Paid accounts retain a per-user 20 requests/minute safety limit.
BEGIN;
CREATE TABLE public.ai_usage (
  user_id text PRIMARY KEY,
  transcriptions bigint NOT NULL DEFAULT 0 CHECK (transcriptions >= 0),
  structures bigint NOT NULL DEFAULT 0 CHECK (structures >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  window_count integer NOT NULL DEFAULT 0
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, authenticated;

CREATE FUNCTION public.reserve_ai_usage(p_user_id text, p_operation text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  usage_row public.ai_usage%ROWTYPE;
  paid boolean;
  moment timestamptz := clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_operation IS NULL OR p_operation NOT IN ('transcribe', 'structure') THEN
    RAISE EXCEPTION 'Invalid usage request';
  END IF;
  INSERT INTO public.ai_usage (user_id) VALUES (p_user_id) ON CONFLICT DO NOTHING;
  SELECT * INTO usage_row FROM public.ai_usage WHERE user_id = p_user_id FOR UPDATE;
  IF moment >= usage_row.window_started_at + interval '1 minute' THEN
    usage_row.window_started_at := moment;
    usage_row.window_count := 0;
  END IF;
  IF usage_row.window_count >= 20 THEN RETURN 'rate_limited'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user_id AND status = 'active') INTO paid;
  IF NOT paid AND ((p_operation = 'transcribe' AND usage_row.transcriptions >= 10)
    OR (p_operation = 'structure' AND usage_row.structures >= 10)) THEN
    RETURN 'quota_exceeded';
  END IF;
  UPDATE public.ai_usage SET
    transcriptions = transcriptions + CASE WHEN p_operation = 'transcribe' THEN 1 ELSE 0 END,
    structures = structures + CASE WHEN p_operation = 'structure' THEN 1 ELSE 0 END,
    window_started_at = usage_row.window_started_at,
    window_count = usage_row.window_count + 1
  WHERE user_id = p_user_id;
  RETURN 'allowed';
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_ai_usage(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(text, text) TO service_role;
COMMIT;

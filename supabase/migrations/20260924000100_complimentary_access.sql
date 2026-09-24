-- Private, explicitly granted access; independent of Stripe billing.
-- No account is granted access by deploying this migration.
BEGIN;
CREATE TABLE public.complimentary_access (
  user_id text PRIMARY KEY CHECK (user_id = lower(btrim(user_id)) AND user_id <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.complimentary_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.complimentary_access FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.complimentary_access TO service_role;

-- Shared by the plan display and the quota gate. Server-authenticated email only.
CREATE FUNCTION public.has_unlimited_ai_access(p_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.complimentary_access
    WHERE user_id = lower(btrim(p_user_id))
  ) OR EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = p_user_id AND status = 'active' AND paid_until > statement_timestamp()
  );
$$;
REVOKE ALL ON FUNCTION public.has_unlimited_ai_access(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_unlimited_ai_access(text) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_ai_usage(p_user_id text, p_operation text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  usage_row public.ai_usage%ROWTYPE;
  unlimited boolean;
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
  SELECT public.has_unlimited_ai_access(p_user_id) INTO unlimited;
  IF NOT unlimited AND ((p_operation = 'transcribe' AND usage_row.transcriptions >= 10)
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

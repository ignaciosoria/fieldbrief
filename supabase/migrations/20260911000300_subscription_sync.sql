-- Same existing service-role ownership boundary; no new client access.
BEGIN;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_created bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_checked_at timestamptz NOT NULL DEFAULT '-infinity',
  ADD COLUMN IF NOT EXISTS paid_until timestamptz;

CREATE OR REPLACE FUNCTION public.sync_subscription_status(
  p_user_id text, p_customer_id text, p_subscription_id text,
  p_status text, p_subscription_created bigint, p_checked_at timestamptz, p_paid_until timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected integer;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_customer_id IS NULL OR p_customer_id = ''
    OR p_subscription_id IS NULL OR p_subscription_id = '' OR p_status IS NULL OR p_status NOT IN ('active','inactive')
    OR p_subscription_created IS NULL OR p_subscription_created <= 0 OR p_checked_at IS NULL
    OR (p_status='active' AND (p_paid_until IS NULL OR p_paid_until<=p_checked_at)) THEN
    RAISE EXCEPTION 'Invalid subscription state';
  END IF;
  INSERT INTO public.subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status,stripe_subscription_created,stripe_checked_at,paid_until)
  VALUES (p_user_id,p_customer_id,p_subscription_id,p_status,p_subscription_created,p_checked_at,p_paid_until)
  ON CONFLICT (user_id) DO UPDATE SET
    stripe_customer_id=EXCLUDED.stripe_customer_id,
    stripe_subscription_id=EXCLUDED.stripe_subscription_id,
    status=EXCLUDED.status,
    stripe_subscription_created=EXCLUDED.stripe_subscription_created,
    stripe_checked_at=EXCLUDED.stripe_checked_at,
    paid_until=EXCLUDED.paid_until
  WHERE
    (subscriptions.stripe_subscription_id=EXCLUDED.stripe_subscription_id
      AND subscriptions.stripe_checked_at<=EXCLUDED.stripe_checked_at)
    OR (subscriptions.stripe_subscription_id IS DISTINCT FROM EXCLUDED.stripe_subscription_id
      AND subscriptions.stripe_subscription_created<=EXCLUDED.stripe_subscription_created
      AND (subscriptions.status IS DISTINCT FROM 'active' OR EXCLUDED.status='active'));
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected>0;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_subscription_status(text,text,text,text,bigint,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_subscription_status(text,text,text,text,bigint,timestamptz,timestamptz) TO service_role;
-- A missed renewal webhook must not leave unlimited AI active forever.
CREATE OR REPLACE FUNCTION public.reserve_ai_usage(p_user_id text, p_operation text)
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
  SELECT EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user_id AND status = 'active' AND paid_until > moment) INTO paid;
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

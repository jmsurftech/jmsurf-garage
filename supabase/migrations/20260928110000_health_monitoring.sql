-- App error reports and uptime checks, written by the app server (service
-- role). Only the platform owner can read the raw data; the public status
-- page reads a summary through public_status().

CREATE TABLE IF NOT EXISTS public.app_errors (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  fingerprint text NOT NULL,
  message text NOT NULL,
  stack text,
  path text,
  source text NOT NULL DEFAULT 'browser',
  tenant_slug text,
  user_agent text,
  emailed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS app_errors_created_idx ON public.app_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS app_errors_unsent_idx ON public.app_errors (emailed) WHERE NOT emailed;

CREATE TABLE IF NOT EXISTS public.uptime_checks (
  id bigserial PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  service text NOT NULL,
  ok boolean NOT NULL,
  ms integer,
  detail text
);
CREATE INDEX IF NOT EXISTS uptime_checks_service_time_idx ON public.uptime_checks (service, checked_at DESC);

ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uptime_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_errors_owner_read ON public.app_errors;
CREATE POLICY app_errors_owner_read ON public.app_errors FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));
DROP POLICY IF EXISTS uptime_owner_read ON public.uptime_checks;
CREATE POLICY uptime_owner_read ON public.uptime_checks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

REVOKE ALL ON public.app_errors, public.uptime_checks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_errors, public.uptime_checks FROM authenticated;
GRANT SELECT ON public.app_errors, public.uptime_checks TO authenticated;

-- Public status: current state and daily uptime per service for 90 days.
CREATE OR REPLACE FUNCTION public.public_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (service) service, ok, ms, checked_at
    FROM uptime_checks
    WHERE checked_at > now() - interval '1 hour'
    ORDER BY service, checked_at DESC
  ),
  daily AS (
    SELECT service, (checked_at AT TIME ZONE 'Africa/Nairobi')::date AS day,
           round(100.0 * count(*) FILTER (WHERE ok) / count(*), 2) AS uptime
    FROM uptime_checks
    WHERE checked_at > now() - interval '90 days'
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'services', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'service', l.service, 'ok', l.ok, 'ms', l.ms, 'checked_at', l.checked_at,
        'uptime_90d', (SELECT round(100.0 * count(*) FILTER (WHERE ok) / nullif(count(*), 0), 2)
                       FROM uptime_checks u WHERE u.service = l.service AND u.checked_at > now() - interval '90 days'),
        'days', (SELECT jsonb_agg(jsonb_build_object('day', d.day, 'uptime', d.uptime) ORDER BY d.day)
                 FROM daily d WHERE d.service = l.service)
      ) ORDER BY l.service) FROM latest l), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.public_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_status() TO anon, authenticated;

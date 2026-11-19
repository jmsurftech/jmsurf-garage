CREATE OR REPLACE FUNCTION public.calculate_period_end(start_date timestamptz, billing_cycle text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE billing_cycle
    WHEN 'monthly' THEN start_date + interval '1 month'
    WHEN 'quarterly' THEN start_date + interval '3 months'
    WHEN 'annually' THEN start_date + interval '1 year'
    ELSE start_date + interval '1 month'
  END
$$;
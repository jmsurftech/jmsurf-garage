-- Paged sales for the Payments screen (2026-09-27)
--
-- The Payments list used to download every sale of the shop. These functions
-- filter, search, count and total inside the database and return one page.
-- SECURITY INVOKER: row-level security applies, so a shop only sees its own
-- sales. Money totals only ever count completed sales.

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_created ON public.transactions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_status_created ON public.transactions (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_cashier_created ON public.transactions (cashier_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.transactions_page(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_cashier text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0,
  p_ascending boolean DEFAULT false
)
RETURNS TABLE (tx jsonb, total bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH f AS (
    SELECT t.*
    FROM public.transactions t
    WHERE t.tenant_id = public.current_user_tenant_id()
      AND (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to IS NULL OR t.created_at <= p_to)
      AND (p_method IS NULL OR t.payment_method = p_method)
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_cashier IS NULL OR coalesce(t.cashier_name, 'Unknown') = p_cashier)
      AND (
        p_search IS NULL OR p_search = '' OR
        t.customer_name ILIKE '%' || p_search || '%' OR
        t.cashier_name ILIKE '%' || p_search || '%' OR
        t.mpesa_ref ILIKE '%' || p_search || '%' OR
        t.id::text ILIKE p_search || '%' OR
        t.items::text ILIKE '%' || p_search || '%'
      )
  )
  SELECT to_jsonb(f.*), count(*) OVER ()
  FROM f
  ORDER BY
    CASE WHEN p_ascending THEN f.created_at END ASC,
    CASE WHEN NOT p_ascending THEN f.created_at END DESC
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 500)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.transactions_summary(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_cashier text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH f AS (
    SELECT t.*
    FROM public.transactions t
    WHERE t.tenant_id = public.current_user_tenant_id()
      AND (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to IS NULL OR t.created_at <= p_to)
      AND (p_method IS NULL OR t.payment_method = p_method)
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_cashier IS NULL OR coalesce(t.cashier_name, 'Unknown') = p_cashier)
      AND (
        p_search IS NULL OR p_search = '' OR
        t.customer_name ILIKE '%' || p_search || '%' OR
        t.cashier_name ILIKE '%' || p_search || '%' OR
        t.mpesa_ref ILIKE '%' || p_search || '%' OR
        t.id::text ILIKE p_search || '%' OR
        t.items::text ILIKE '%' || p_search || '%'
      )
  )
  SELECT jsonb_build_object(
    'count', count(*),
    'completed', count(*) FILTER (WHERE status = 'completed'),
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'failed', count(*) FILTER (WHERE status IN ('failed', 'cancelled')),
    'total', coalesce(sum(total) FILTER (WHERE status = 'completed' AND payment_method <> 'credit_note'), 0),
    'cash', coalesce(sum(total) FILTER (WHERE status = 'completed' AND payment_method = 'cash'), 0),
    'mpesa', coalesce(sum(total) FILTER (WHERE status = 'completed' AND payment_method = 'mpesa'), 0),
    'card', coalesce(sum(total) FILTER (WHERE status = 'completed' AND payment_method = 'card'), 0),
    'credit', coalesce(sum(total) FILTER (WHERE status = 'completed' AND payment_method = 'credit'), 0),
    'other', coalesce(sum(total) FILTER (WHERE status = 'completed' AND payment_method NOT IN ('cash','mpesa','card','credit','credit_note')), 0),
    'cashiers', coalesce((SELECT jsonb_agg(DISTINCT coalesce(x.cashier_name, 'Unknown'))
                          FROM public.transactions x WHERE x.tenant_id = public.current_user_tenant_id()), '[]'::jsonb)
  )
  FROM f;
$$;

REVOKE ALL ON FUNCTION public.transactions_page(timestamptz, timestamptz, text, text, text, text, int, int, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transactions_summary(timestamptz, timestamptz, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transactions_page(timestamptz, timestamptz, text, text, text, text, int, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transactions_summary(timestamptz, timestamptz, text, text, text, text) TO authenticated;

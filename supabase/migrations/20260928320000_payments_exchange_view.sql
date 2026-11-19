-- 2026-09-28: Payments hides internal exchange-credit rows and flags exchange sales.
CREATE OR REPLACE FUNCTION public.transactions_page(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_method text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_cashier text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_ascending boolean DEFAULT false)
 RETURNS TABLE(tx jsonb, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH f AS (
    SELECT t.*
    FROM public.transactions t
    WHERE t.tenant_id = public.current_user_tenant_id()
      AND (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to IS NULL OR t.created_at <= p_to)
      AND (p_method IS NULL OR t.payment_method = p_method)
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_cashier IS NULL OR coalesce(t.cashier_name, 'Unknown') = p_cashier)
      -- Exchange credit moved between sales is not a payment.
      AND NOT (t.refund_of IS NOT NULL AND t.total = 0)
      AND (
        p_search IS NULL OR p_search = '' OR
        t.customer_name ILIKE '%' || p_search || '%' OR
        t.cashier_name ILIKE '%' || p_search || '%' OR
        t.mpesa_ref ILIKE '%' || p_search || '%' OR
        t.id::text ILIKE p_search || '%' OR
        t.items::text ILIKE '%' || p_search || '%'
      )
  )
  SELECT to_jsonb(f.*) || jsonb_build_object('is_exchange', EXISTS (SELECT 1 FROM public.sale_returns sr WHERE sr.exchange_transaction_id = f.id)), count(*) OVER ()
  FROM f
  ORDER BY
    CASE WHEN p_ascending THEN f.created_at END ASC,
    CASE WHEN NOT p_ascending THEN f.created_at END DESC
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 500)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$function$;

CREATE OR REPLACE FUNCTION public.transactions_summary(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_method text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_cashier text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH f AS (
    SELECT t.*
    FROM public.transactions t
    WHERE t.tenant_id = public.current_user_tenant_id()
      AND (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to IS NULL OR t.created_at <= p_to)
      AND (p_method IS NULL OR t.payment_method = p_method)
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_cashier IS NULL OR coalesce(t.cashier_name, 'Unknown') = p_cashier)
      -- Exchange credit moved between sales is not a payment.
      AND NOT (t.refund_of IS NOT NULL AND t.total = 0)
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
$function$;

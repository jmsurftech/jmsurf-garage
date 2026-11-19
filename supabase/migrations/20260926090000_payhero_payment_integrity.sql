-- A POS sale can have only one PayHero STK request. Reserve it before calling
-- PayHero so two clicks cannot create two prompts for the same sale.
CREATE UNIQUE INDEX IF NOT EXISTS payhero_one_request_per_sale
  ON public.payhero_transactions (pos_transaction_id)
  WHERE pos_transaction_id IS NOT NULL
    AND created_at >= '2026-09-26 00:00:00+00'::timestamptz;

CREATE OR REPLACE FUNCTION public.settle_payhero_payment(
  p_pos_transaction_id uuid,
  p_status text,
  p_receipt text DEFAULT NULL,
  p_provider_status jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  p public.payhero_transactions%ROWTYPE;
  t public.transactions%ROWTYPE;
  line_item jsonb;
  product_uuid uuid;
  variant_uuid uuid;
  quantity numeric;
  per_unit numeric;
  before_stock numeric;
  after_stock numeric;
BEGIN
  IF p_status NOT IN ('pending','completed','failed','cancelled') THEN
    RAISE EXCEPTION 'Invalid payment outcome';
  END IF;
  SELECT * INTO p FROM public.payhero_transactions
    WHERE pos_transaction_id = p_pos_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PayHero payment not found'; END IF;
  SELECT * INTO t FROM public.transactions
    WHERE id = p_pos_transaction_id AND tenant_id = p.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found for payment'; END IF;
  IF p.amount IS DISTINCT FROM t.total THEN RAISE EXCEPTION 'Payment amount does not match sale'; END IF;
  IF p.status = 'completed' THEN RETURN 'completed'; END IF;
  IF t.status = 'completed' THEN
    RAISE EXCEPTION 'Sale was completed outside the PayHero payment';
  END IF;
  IF p.status IN ('failed','cancelled') AND p_status <> 'completed' THEN RETURN p.status; END IF;

  IF p_status = 'completed' THEN
    IF coalesce(trim(p_receipt),'') = '' THEN
      RAISE EXCEPTION 'Confirmed payment requires an M-Pesa receipt';
    END IF;
    UPDATE public.transactions SET status = 'completed', mpesa_ref = p_receipt,
      mpesa_error_message = NULL, mpesa_error_payload = NULL
      WHERE id = t.id;
    IF t.location_id IS NOT NULL AND jsonb_typeof(t.items::jsonb) = 'array' THEN
      FOR line_item IN SELECT value FROM jsonb_array_elements(t.items::jsonb) LOOP
        IF coalesce(line_item->>'is_service','false') = 'true' THEN CONTINUE; END IF;
        product_uuid := nullif(coalesce(line_item->>'product_id', line_item->>'id'),'')::uuid;
        variant_uuid := nullif(line_item->>'variant_id','')::uuid;
        quantity := coalesce(nullif(line_item->>'quantity','')::numeric,0);
        per_unit := coalesce(nullif(line_item->>'stock_per_unit','')::numeric,1);
        IF product_uuid IS NULL OR quantity <= 0 THEN CONTINUE; END IF;
        IF variant_uuid IS NOT NULL THEN
          SELECT stock INTO before_stock FROM public.product_variants
            WHERE id = variant_uuid AND product_id = product_uuid FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Missing stock variant %', variant_uuid; END IF;
          after_stock := greatest(0, before_stock - quantity);
          UPDATE public.product_variants SET stock = after_stock WHERE id = variant_uuid;
          INSERT INTO public.stock_adjustments
            (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason)
          VALUES (product_uuid, variant_uuid, t.location_id, -quantity, before_stock, after_stock, 'sale');
        ELSE
          SELECT stock INTO before_stock FROM public.product_stocks
            WHERE product_id = product_uuid AND location_id = t.location_id FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Missing stock row for product %', product_uuid; END IF;
          after_stock := greatest(0, before_stock - quantity * per_unit);
          UPDATE public.product_stocks SET stock = after_stock
            WHERE product_id = product_uuid AND location_id = t.location_id;
          INSERT INTO public.stock_adjustments
            (product_id, location_id, quantity_change, stock_before, stock_after, reason)
          VALUES (product_uuid, t.location_id, -(quantity * per_unit), before_stock, after_stock, 'sale');
        END IF;
      END LOOP;
    END IF;
  ELSIF p_status IN ('failed','cancelled') THEN
    UPDATE public.transactions SET status = p_status,
      mpesa_error_message = left(coalesce(p_provider_status->>'message', p_provider_status->>'status', p_status), 500),
      mpesa_error_payload = p_provider_status
      WHERE id = t.id AND status = 'pending';
  END IF;
  UPDATE public.payhero_transactions SET status = p_status,
    mpesa_receipt = CASE WHEN p_status = 'completed' THEN p_receipt ELSE mpesa_receipt END,
    result_desc = left(coalesce(p_provider_status->>'status', p_status), 500),
    raw_callback = p_provider_status,
    updated_at = now()
    WHERE id = p.id;
  RETURN p_status;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_payhero_payment(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payhero_payment(uuid,text,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';

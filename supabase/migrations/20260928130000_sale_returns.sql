-- Returns and refunds.
-- A return puts the items back in stock and records the refund as a negative
-- completed sale (refund_of = original sale), so every report, shift total and
-- cash-up nets it out without special cases. The original sale is unchanged
-- apart from refunded_amount.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS refund_of uuid REFERENCES public.transactions(id),
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS transactions_refund_of_idx ON public.transactions (refund_of) WHERE refund_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id),
  refund_transaction_id uuid REFERENCES public.transactions(id),
  location_id uuid,
  return_number text NOT NULL,
  items jsonb NOT NULL,
  refund_amount numeric NOT NULL CHECK (refund_amount >= 0),
  refund_method text NOT NULL,
  restocked boolean NOT NULL DEFAULT true,
  reason text,
  customer_id uuid,
  customer_name text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sale_returns_tenant_idx ON public.sale_returns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sale_returns_tx_idx ON public.sale_returns (transaction_id);

ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_returns_read ON public.sale_returns;
CREATE POLICY sale_returns_read ON public.sale_returns FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
REVOKE ALL ON public.sale_returns FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sale_returns FROM authenticated;
GRANT SELECT ON public.sale_returns TO authenticated;

-- p_items: [{ "product_id": uuid, "variant_id": uuid|null, "quantity": n }]
-- p_method: cash | mpesa | card | bank_transfer | credit (credit = lower what the customer owes)
CREATE OR REPLACE FUNCTION public.process_sale_return(
  p_transaction_id uuid, p_items jsonb, p_method text, p_reason text DEFAULT NULL, p_restock boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  t public.transactions%ROWTYPE;
  line jsonb; sold jsonb;
  pid uuid; vid uuid; qty numeric; sold_qty numeric; already numeric; unit_price numeric; per_unit numeric;
  factor numeric; gross numeric := 0; refund numeric := 0; lines jsonb := '[]'::jsonb;
  before_stock numeric; after_stock numeric;
  refund_tx uuid; ret_id uuid; ret_no text; staff_name text; items_total numeric := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'manager') OR public.has_role(_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'Only a manager or the owner can process returns';
  END IF;
  IF p_method NOT IN ('cash', 'mpesa', 'card', 'bank_transfer', 'credit') THEN RAISE EXCEPTION 'Choose how the money is refunded'; END IF;

  SELECT * INTO t FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF t.tenant_id <> public.current_user_tenant_id() AND NOT public.has_role(_uid, 'super_admin') THEN RAISE EXCEPTION 'This sale belongs to another shop'; END IF;
  IF t.status <> 'completed' OR t.refund_of IS NOT NULL OR t.total <= 0 THEN RAISE EXCEPTION 'Only a completed sale can be returned'; END IF;
  IF p_method = 'credit' AND t.customer_id IS NULL THEN RAISE EXCEPTION 'A refund to account needs a customer on the sale'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Choose what is being returned'; END IF;

  -- Discounts on the sale are shared across its lines.
  SELECT coalesce(sum(coalesce((i->>'price')::numeric, 0) * coalesce((i->>'quantity')::numeric, 0)), 0)
    INTO items_total FROM jsonb_array_elements(t.items) i;
  factor := CASE WHEN items_total > 0 THEN least(1, t.total / items_total) ELSE 1 END;

  FOR line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    pid := nullif(line->>'product_id', '')::uuid;
    vid := nullif(line->>'variant_id', '')::uuid;
    qty := coalesce((line->>'quantity')::numeric, 0);
    IF pid IS NULL OR qty <= 0 THEN CONTINUE; END IF;

    SELECT value INTO sold FROM jsonb_array_elements(t.items) value
      WHERE coalesce(value->>'product_id', value->>'id') = pid::text
        AND coalesce(nullif(value->>'variant_id', ''), '') = coalesce(vid::text, '')
      LIMIT 1;
    IF sold IS NULL THEN RAISE EXCEPTION 'An item was not part of this sale'; END IF;
    sold_qty := coalesce((sold->>'quantity')::numeric, 0);
    SELECT coalesce(sum((r->>'quantity')::numeric), 0) INTO already
      FROM public.sale_returns sr, jsonb_array_elements(sr.items) r
      WHERE sr.transaction_id = t.id AND r->>'product_id' = pid::text AND coalesce(r->>'variant_id', '') = coalesce(vid::text, '');
    IF qty > sold_qty - already THEN
      RAISE EXCEPTION '% was bought % time(s); % already returned', coalesce(sold->>'name', 'An item'), sold_qty, already;
    END IF;

    unit_price := coalesce((sold->>'price')::numeric, 0);
    per_unit := coalesce(nullif(sold->>'stock_per_unit', '')::numeric, 1);
    gross := gross + unit_price * qty;
    lines := lines || jsonb_build_object('product_id', pid, 'variant_id', vid, 'name', sold->>'name', 'quantity', qty,
      'price', unit_price, 'size', sold->>'size', 'color', sold->>'color', 'is_service', coalesce(sold->>'is_service', 'false'));

    -- Back into stock (services and "don't restock" returns are skipped).
    IF p_restock AND coalesce(sold->>'is_service', 'false') <> 'true' AND t.location_id IS NOT NULL THEN
      IF vid IS NOT NULL THEN
        SELECT stock INTO before_stock FROM public.product_variants WHERE id = vid FOR UPDATE;
        IF FOUND THEN
          after_stock := before_stock + qty;
          UPDATE public.product_variants SET stock = after_stock WHERE id = vid;
          INSERT INTO public.stock_adjustments (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
          VALUES (pid, vid, t.location_id, qty, before_stock, after_stock, 'return', _uid);
        END IF;
      ELSE
        INSERT INTO public.product_stocks (product_id, location_id, stock) VALUES (pid, t.location_id, 0)
          ON CONFLICT (product_id, location_id) DO NOTHING;
        SELECT stock INTO before_stock FROM public.product_stocks WHERE product_id = pid AND location_id = t.location_id FOR UPDATE;
        after_stock := round(before_stock + qty * per_unit, 3);
        UPDATE public.product_stocks SET stock = after_stock WHERE product_id = pid AND location_id = t.location_id;
        INSERT INTO public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
        VALUES (pid, t.location_id, qty * per_unit, before_stock, after_stock, 'return', _uid);
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(lines) = 0 THEN RAISE EXCEPTION 'Choose what is being returned'; END IF;
  refund := round(gross * factor, 2);
  IF refund > t.total - t.refunded_amount + 0.01 THEN refund := greatest(0, t.total - t.refunded_amount); END IF;

  SELECT display_name INTO staff_name FROM public.profiles WHERE user_id = _uid;
  ret_no := 'RET-' || upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint));

  -- The refund as a negative completed sale; stock is already handled above.
  INSERT INTO public.transactions (items, subtotal, tax, discount, total, payment_method, customer_id, customer_name,
    status, cashier_id, cashier_name, location_id, tenant_id, refund_of, stock_by_server, stock_applied_at)
  VALUES (lines, -round(gross, 2), 0, 0, -refund, p_method, t.customer_id, t.customer_name,
    'completed', _uid, coalesce(staff_name, 'Staff'), t.location_id, t.tenant_id, t.id, false, now())
  RETURNING id INTO refund_tx;

  -- The finished-sale guard allows this one field to be changed from here.
  PERFORM set_config('app.sale_return', '1', true);
  UPDATE public.transactions SET refunded_amount = refunded_amount + refund WHERE id = t.id;
  PERFORM set_config('app.sale_return', '', true);

  IF p_method = 'credit' THEN
    UPDATE public.customers SET balance = coalesce(balance, 0) - refund WHERE id = t.customer_id AND tenant_id = t.tenant_id;
  END IF;

  INSERT INTO public.sale_returns (tenant_id, transaction_id, refund_transaction_id, location_id, return_number, items,
    refund_amount, refund_method, restocked, reason, customer_id, customer_name, created_by, created_by_name)
  VALUES (t.tenant_id, t.id, refund_tx, t.location_id, ret_no, lines, refund, p_method, p_restock, nullif(trim(p_reason), ''),
    t.customer_id, t.customer_name, _uid, staff_name)
  RETURNING id INTO ret_id;

  RETURN jsonb_build_object('return_id', ret_id, 'return_number', ret_no, 'refund', refund, 'refund_transaction_id', refund_tx);
END;
$$;
REVOKE ALL ON FUNCTION public.process_sale_return(uuid, jsonb, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_return(uuid, jsonb, text, text, boolean) TO authenticated;

-- Let process_sale_return record refunded_amount on a finished sale.
CREATE OR REPLACE FUNCTION public.guard_transaction_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- App server (service key) and database maintenance are not restricted.
  IF _uid IS NULL
     OR public.has_role(_uid, 'super_admin')
     OR public.has_role(_uid, 'admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Only the shop owner can delete sales';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A sale cannot be moved to another shop';
  END IF;

  -- A return may only change how much of the sale has been refunded.
  IF current_setting('app.sale_return', true) = '1'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.total IS NOT DISTINCT FROM OLD.total
     AND NEW.items IS NOT DISTINCT FROM OLD.items THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' THEN
    RETURN NEW;
  END IF;

  IF OLD.cashier_id = _uid
     AND OLD.created_at > now() - interval '15 minutes'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.total IS NOT DISTINCT FROM OLD.total THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only the shop owner can change a finished sale';
END;
$function$;

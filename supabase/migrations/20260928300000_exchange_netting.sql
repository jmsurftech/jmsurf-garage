-- 2026-09-28: exchanges settle only the difference. The returned value pays
-- for the new items (shown as exchange credit on the new sale), so the new
-- sale total is exactly what the customer still pays, which lets the till
-- send an M-Pesa prompt for it. A refund only records money actually given back.

DROP FUNCTION IF EXISTS public.process_sale_exchange(uuid, jsonb, jsonb, text, text, boolean);
DROP FUNCTION IF EXISTS public.process_sale_return(uuid, jsonb, text, text, boolean);

CREATE OR REPLACE FUNCTION public.process_sale_return(p_transaction_id uuid, p_items jsonb, p_method text, p_reason text DEFAULT NULL::text, p_restock boolean DEFAULT true, p_credit_used numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  t public.transactions%ROWTYPE;
  line jsonb; sold jsonb;
  pid uuid; vid uuid; qty numeric; sold_qty numeric; already numeric; unit_price numeric; per_unit numeric;
  factor numeric; gross numeric := 0; refund numeric := 0; lines jsonb := '[]'::jsonb;
  before_stock numeric; after_stock numeric;
  refund_tx uuid; ret_id uuid; val numeric := 0; used numeric := 0; ret_no text; staff_name text; items_total numeric := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'manager') OR public.has_role(_uid, 'cashier')
          OR public.has_role(_uid, 'sales_person') OR public.has_role(_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'You are not allowed to process returns';
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
  val := round(gross * factor, 2);
  IF val > t.total - t.refunded_amount + 0.01 THEN val := greatest(0, t.total - t.refunded_amount); END IF;
  -- In an exchange part (or all) of the value pays for the new items instead
  -- of going back to the customer, so only the rest is money out.
  used := least(val, greatest(0, round(coalesce(p_credit_used, 0), 2)));
  refund := val - used;

  SELECT display_name INTO staff_name FROM public.profiles WHERE user_id = _uid;
  ret_no := 'RET-' || upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint));

  -- The refund as a negative completed sale; stock is already handled above.
  INSERT INTO public.transactions (items, subtotal, tax, discount, total, payment_method, customer_id, customer_name,
    status, cashier_id, cashier_name, location_id, tenant_id, refund_of, stock_by_server, stock_applied_at)
  VALUES (lines, -round(gross, 2), 0, 0, -refund, CASE WHEN refund > 0 THEN p_method ELSE 'credit_note' END, t.customer_id, t.customer_name,
    'completed', _uid, coalesce(staff_name, 'Staff'), t.location_id, t.tenant_id, t.id, false, now())
  RETURNING id INTO refund_tx;

  -- The finished-sale guard allows this one field to be changed from here.
  PERFORM set_config('app.sale_return', '1', true);
  UPDATE public.transactions SET refunded_amount = refunded_amount + val WHERE id = t.id;
  PERFORM set_config('app.sale_return', '', true);

  IF p_method = 'credit' AND refund > 0 THEN
    UPDATE public.customers SET balance = coalesce(balance, 0) - refund WHERE id = t.customer_id AND tenant_id = t.tenant_id;
  END IF;

  INSERT INTO public.sale_returns (tenant_id, transaction_id, refund_transaction_id, location_id, return_number, items,
    refund_amount, refund_method, restocked, reason, customer_id, customer_name, created_by, created_by_name)
  VALUES (t.tenant_id, t.id, refund_tx, t.location_id, ret_no, lines, refund, p_method, p_restock, nullif(trim(p_reason), ''),
    t.customer_id, t.customer_name, _uid, staff_name)
  RETURNING id INTO ret_id;

  RETURN jsonb_build_object('return_id', ret_id, 'return_number', ret_no, 'refund', refund, 'value', val, 'credit_used', used, 'refund_transaction_id', refund_tx);
END;
$function$;
REVOKE ALL ON FUNCTION public.process_sale_return(uuid, jsonb, text, text, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_return(uuid, jsonb, text, text, boolean, numeric) TO authenticated;

/**
 * p_new_items: [{ "product_id": uuid, "variant_id": uuid|null, "quantity": n }]
 * p_pending: the balance is collected by M-Pesa prompt, so the new sale is
 * saved as a pending M-Pesa sale; stock leaves when the payment completes.
 */
CREATE OR REPLACE FUNCTION public.process_sale_exchange(
  p_transaction_id uuid, p_return_items jsonb, p_new_items jsonb, p_method text, p_reason text DEFAULT NULL,
  p_restock boolean DEFAULT true, p_pending boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid(); t public.transactions%ROWTYPE; ret jsonb; l jsonb; p public.products%ROWTYPE; v public.product_variants%ROWTYPE;
  pid uuid; vid uuid; qty numeric; price numeric; cost numeric; vat numeric; have numeric; label text;
  items jsonb := '[]'::jsonb; sub numeric := 0; tax numeric := 0; sale_id uuid; staff_name text;
  used numeric; due numeric; rvalue numeric; pending boolean;
BEGIN
  IF jsonb_typeof(p_new_items) <> 'array' OR jsonb_array_length(p_new_items) = 0 THEN
    RAISE EXCEPTION 'Choose what the customer is taking instead';
  END IF;
  SELECT * INTO t FROM public.transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;

  -- 1. The replacement items at today's prices, with a stock check.
  FOR l IN SELECT value FROM jsonb_array_elements(p_new_items) LOOP
    pid := nullif(l->>'product_id', '')::uuid; vid := nullif(l->>'variant_id', '')::uuid; qty := coalesce((l->>'quantity')::numeric, 0);
    IF pid IS NULL OR qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO p FROM public.products WHERE id = pid AND tenant_id = t.tenant_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'A new item is not in this shop'; END IF;
    price := p.price; cost := coalesce(p.cost_price, 0); vat := coalesce(p.vat_rate, 0); label := p.name;
    IF vid IS NOT NULL THEN
      SELECT * INTO v FROM public.product_variants WHERE id = vid AND product_id = pid AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'That size or colour is not available'; END IF;
      price := coalesce(nullif(v.price, 0), p.price); cost := coalesce(nullif(v.cost_price, 0), cost); have := v.stock;
    ELSE
      SELECT stock INTO have FROM public.product_stocks WHERE product_id = pid AND location_id = t.location_id;
      have := coalesce(have, 0);
    END IF;
    IF coalesce(have, 0) < qty THEN RAISE EXCEPTION 'Only % of % left in stock', coalesce(have, 0), label; END IF;
    items := items || jsonb_build_object('id', pid, 'product_id', pid, 'variant_id', vid, 'name', label, 'size', v.size, 'color', v.color,
      'price', price, 'quantity', qty, 'cost_price', cost, 'vat_rate', vat, 'stock_per_unit', 1, 'is_service', false, 'price_mode', 'retail');
    sub := sub + price * qty;
    tax := tax + CASE WHEN vat > 0 THEN price * qty * vat / (100 + vat) ELSE 0 END;
    v := NULL;
  END LOOP;
  IF jsonb_array_length(items) = 0 THEN RAISE EXCEPTION 'Choose what the customer is taking instead'; END IF;
  sub := round(sub, 2);

  -- 2. The return; its value pays for the new items first.
  ret := public.process_sale_return(p_transaction_id, p_return_items, p_method,
    coalesce(nullif(trim(p_reason), ''), 'Exchange'), p_restock, sub);
  used := (ret->>'credit_used')::numeric;
  rvalue := (ret->>'value')::numeric;
  due := round(sub - used, 2);
  pending := coalesce(p_pending, false) AND due > 0;
  IF pending AND (due <> trunc(due) OR due > 150000) THEN
    RAISE EXCEPTION 'M-Pesa needs a whole amount up to 150,000. Take cash for this exchange.';
  END IF;

  -- 3. The new sale carries the exchange credit as its discount.
  SELECT display_name INTO staff_name FROM public.profiles WHERE user_id = _uid;
  INSERT INTO public.transactions (items, subtotal, tax, discount, total, payment_method, customer_id, customer_name, status,
    cashier_id, cashier_name, location_id, tenant_id, stock_by_server)
  VALUES (items, sub, round(tax, 2), used, due,
    CASE WHEN pending THEN 'mpesa' WHEN due = 0 THEN 'credit_note' ELSE p_method END,
    t.customer_id, t.customer_name, CASE WHEN pending THEN 'pending' ELSE 'completed' END,
    _uid, coalesce(staff_name, 'Staff'), t.location_id, t.tenant_id, true)
  RETURNING id INTO sale_id;

  -- On account: the customer owes the balance.
  IF p_method = 'credit' AND NOT pending AND due > 0 AND t.customer_id IS NOT NULL THEN
    UPDATE public.customers SET balance = coalesce(balance, 0) + due WHERE id = t.customer_id AND tenant_id = t.tenant_id;
  END IF;

  UPDATE public.sale_returns SET exchange_transaction_id = sale_id, exchange_total = sub, balance = round(sub - rvalue, 2)
   WHERE id = (ret->>'return_id')::uuid;

  RETURN ret || jsonb_build_object('exchange_transaction_id', sale_id, 'new_total', sub,
    'difference', round(sub - rvalue, 2), 'due', due, 'pending', pending);
END $$;
REVOKE ALL ON FUNCTION public.process_sale_exchange(uuid, jsonb, jsonb, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_exchange(uuid, jsonb, jsonb, text, text, boolean, boolean) TO authenticated;

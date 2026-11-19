-- 2026-09-29: exchange sales keep a real payment method (never credit_note, which
-- reports read as a refund) and record the exchange credit in split_payments.
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
    cashier_id, cashier_name, location_id, tenant_id, stock_by_server, split_payments)
  VALUES (items, sub, round(tax, 2), used, due,
    CASE WHEN pending THEN 'mpesa' WHEN p_method = 'credit' AND due = 0 THEN 'cash' ELSE p_method END,
    t.customer_id, t.customer_name, CASE WHEN pending THEN 'pending' ELSE 'completed' END,
    _uid, coalesce(staff_name, 'Staff'), t.location_id, t.tenant_id, true,
    -- Marks the part paid by returned goods, so reports do not count it as a discount.
    jsonb_build_array(jsonb_build_object('method', 'exchange_credit', 'amount', used)))
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

-- Exchange sales already made: same marker, and no credit_note method.
UPDATE public.transactions x SET split_payments = jsonb_build_array(jsonb_build_object('method', 'exchange_credit', 'amount', x.discount)),
  payment_method = CASE WHEN x.payment_method = 'credit_note' THEN 'cash' ELSE x.payment_method END
 FROM public.sale_returns sr WHERE sr.exchange_transaction_id = x.id AND x.split_payments IS NULL;

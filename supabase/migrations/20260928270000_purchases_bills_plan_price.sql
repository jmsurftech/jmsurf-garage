-- 2026-09-28: partial receiving and supplier payments for purchase orders,
-- purchases in another currency, and correct package price for new shops.

-- 1. New shops (self sign-up and admin-created) get the chosen package, its
--    monthly price and its trial length. The price was always 0 before, so
--    Plan and billing showed KES 0.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid;
  _slug text;
  _try_slug text;
  _suffix int;
  _btype public.business_type;
  _plan record;
  _cycle text;
  _trial interval;
  _country text;
  _currency text;
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name, tenant_id)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NULL)
    ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create profile for %: %', NEW.id, SQLERRM;
  END;

  IF NEW.raw_user_meta_data->>'registration_type' = 'tenant' THEN
    BEGIN
      _slug := COALESCE(NEW.raw_user_meta_data->>'store_slug', '');
      _try_slug := NULLIF(_slug, '');
      _suffix := 1;
      WHILE _try_slug IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants WHERE slug = _try_slug) LOOP
        _try_slug := _slug || '-' || _suffix;
        _suffix := _suffix + 1;
        EXIT WHEN _suffix > 50;
      END LOOP;

      BEGIN
        _btype := COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_type',''), 'general')::public.business_type;
      EXCEPTION WHEN OTHERS THEN
        _btype := 'general';
      END;

      INSERT INTO public.tenants (
        business_name, business_email, business_phone, business_address,
        industry, contact_name, contact_email, contact_phone, owner_user_id, slug,
        activation_fee_paid_at, business_type
      ) VALUES (
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address',
        NEW.raw_user_meta_data->>'industry',
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'contact_name',''), NEW.email),
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'contact_email',''), NEW.email),
        NEW.raw_user_meta_data->>'contact_phone',
        NEW.id,
        _try_slug,
        now(),
        _btype
      ) RETURNING id INTO _tenant_id;

      UPDATE public.profiles SET tenant_id = _tenant_id WHERE user_id = NEW.id;
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;

      -- Country and currency chosen at registration (checked, with safe defaults).
      _country := upper(COALESCE(NEW.raw_user_meta_data->>'country', ''));
      IF _country !~ '^[A-Z]{2}$' THEN _country := 'KE'; END IF;
      _currency := upper(COALESCE(NEW.raw_user_meta_data->>'currency', ''));
      IF _currency !~ '^[A-Z]{3}$' THEN _currency := 'KES'; END IF;

      INSERT INTO public.business_settings (tenant_id, business_name, business_email, business_phone, business_address, country, currency)
      VALUES (
        _tenant_id,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address',
        _country,
        _currency
      );

      -- The package chosen when the shop was created (admin), else the entry package.
      BEGIN
        SELECT * INTO _plan FROM public.plans
         WHERE is_active = true AND id = NULLIF(NEW.raw_user_meta_data->>'plan_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN _plan := NULL;
      END;
      IF _plan.id IS NULL THEN
        SELECT * INTO _plan FROM public.plans WHERE is_active = true ORDER BY price_monthly ASC LIMIT 1;
      END IF;
      _cycle := COALESCE(NULLIF(NEW.raw_user_meta_data->>'billing_cycle', ''), 'monthly');
      IF _cycle NOT IN ('monthly', 'quarterly', 'semi_annually', 'annually') THEN _cycle := 'monthly'; END IF;
      _trial := make_interval(days => GREATEST(1, COALESCE(_plan.trial_days, 14)));
      INSERT INTO public.subscriptions (
        tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price,
        status, trial_ends_at, current_period_start, current_period_end
      ) VALUES (
        _tenant_id, _plan.id, COALESCE(_plan.name, 'Basic'), _cycle,
        COALESCE(_plan.max_users, 3), COALESCE(_plan.max_locations, 1), COALESCE(_plan.price_monthly, 0),
        'trialing', now() + _trial, now(), now() + _trial
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed tenant setup for user %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

UPDATE public.subscriptions s SET price = p.price_monthly
  FROM public.plans p
 WHERE p.id = s.plan_id AND coalesce(s.price, 0) = 0 AND coalesce(p.price_monthly, 0) > 0;

-- 2. Purchase orders: currency, partial receiving, payment status.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS foreign_total numeric,
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_payment_status_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_payment_status_check CHECK (payment_status IN ('unpaid', 'partial', 'paid'));
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_exchange_rate_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_exchange_rate_check CHECK (exchange_rate > 0);

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS received_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS foreign_unit_cost numeric;
-- Orders already received were received in full.
UPDATE public.purchase_items i SET received_quantity = i.quantity
  FROM public.purchases p WHERE p.id = i.purchase_id AND p.status = 'received' AND i.received_quantity = 0;

ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;
UPDATE public.bills SET amount_paid = amount WHERE status = 'paid' AND amount_paid = 0 AND NOT is_recurring;

-- 3. Payments to suppliers (and any other bill). Written only through the functions below.
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  purchase_id uuid,
  supplier_id uuid,
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash',
  reference text,
  paid_on date NOT NULL DEFAULT current_date,
  notes text,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_payments_bill ON public.supplier_payments (bill_id, created_at DESC);
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_payments_read ON public.supplier_payments;
CREATE POLICY supplier_payments_read ON public.supplier_payments FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
REVOKE ALL ON public.supplier_payments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.supplier_payments FROM authenticated;
GRANT SELECT ON public.supplier_payments TO authenticated;

CREATE OR REPLACE FUNCTION public._can_manage_purchases(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (p_tenant = public.current_user_tenant_id() AND (
      public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'stock_manager'))));
$$;
REVOKE ALL ON FUNCTION public._can_manage_purchases(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_manage_purchases(uuid) TO authenticated;

/** The supplier bill for a purchase order: created on first need, amount = value received so far (or the order total when nothing is received yet). */
CREATE OR REPLACE FUNCTION public._purchase_bill(p_purchase uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE po public.purchases%ROWTYPE; _bill uuid; _received numeric; _amount numeric; _paid numeric;
BEGIN
  SELECT * INTO po FROM public.purchases WHERE id = p_purchase;
  SELECT coalesce(sum(received_quantity * unit_cost), 0) INTO _received FROM public.purchase_items WHERE purchase_id = p_purchase;
  _amount := round(CASE WHEN _received > 0 THEN _received ELSE po.total END, 2);
  SELECT id, amount_paid INTO _bill, _paid FROM public.bills WHERE purchase_id = p_purchase ORDER BY created_at LIMIT 1;
  IF _bill IS NULL THEN
    INSERT INTO public.bills (name, category, amount, status, supplier_id, location_id, tenant_id, purchase_id, created_by, notes)
    VALUES ('PO #' || upper(left(po.id::text, 8)) || ' - ' || coalesce(nullif(po.supplier_name, ''), 'Supplier'), 'Purchase Order',
            _amount, 'pending', po.supplier_id, po.location_id, po.tenant_id, po.id, auth.uid(), 'From purchase order')
    RETURNING id INTO _bill;
    _paid := 0;
  ELSE
    UPDATE public.bills SET amount = _amount,
      status = CASE WHEN amount_paid >= _amount - 0.009 AND _amount > 0 THEN 'paid' WHEN amount_paid > 0 THEN 'partial' ELSE 'pending' END
     WHERE id = _bill;
  END IF;
  RETURN _bill;
END $$;
REVOKE ALL ON FUNCTION public._purchase_bill(uuid) FROM PUBLIC, anon, authenticated;

/**
 * Receive some or all of a purchase order. p_lines: [{ "item_id": uuid, "quantity": number }].
 * Adds stock (logged), updates the buying price in the shop's currency, and
 * keeps the supplier bill equal to what has been delivered.
 */
CREATE OR REPLACE FUNCTION public.receive_purchase(p_purchase uuid, p_lines jsonb, p_update_cost boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE po public.purchases%ROWTYPE; l jsonb; it public.purchase_items%ROWTYPE; _qty numeric; _before numeric; _after numeric;
        _lines int := 0; _left numeric;
BEGIN
  SELECT * INTO po FROM public.purchases WHERE id = p_purchase FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT public._can_manage_purchases(po.tenant_id) THEN RAISE EXCEPTION 'You are not allowed to receive stock'; END IF;
  IF po.status = 'received' THEN RAISE EXCEPTION 'This order is already fully received'; END IF;
  IF po.location_id IS NULL THEN RAISE EXCEPTION 'This order has no branch'; END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    _qty := coalesce((l->>'quantity')::numeric, 0);
    CONTINUE WHEN _qty = 0;
    SELECT * INTO it FROM public.purchase_items WHERE id = (l->>'item_id')::uuid AND purchase_id = p_purchase FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A line does not belong to this order'; END IF;
    IF _qty < 0 OR _qty > it.quantity - it.received_quantity + 0.0001 THEN
      RAISE EXCEPTION 'Receiving % but only % of this line is still to come', _qty, it.quantity - it.received_quantity;
    END IF;

    IF it.variant_id IS NOT NULL THEN
      SELECT stock INTO _before FROM public.product_variants WHERE id = it.variant_id FOR UPDATE;
      _after := coalesce(_before, 0) + _qty;
      UPDATE public.product_variants SET stock = _after,
        cost_price = CASE WHEN p_update_cost AND it.unit_cost > 0 THEN it.unit_cost ELSE cost_price END
       WHERE id = it.variant_id;
    ELSE
      INSERT INTO public.product_stocks (product_id, location_id, stock) VALUES (it.product_id, po.location_id, 0)
        ON CONFLICT (product_id, location_id) DO NOTHING;
      SELECT stock INTO _before FROM public.product_stocks WHERE product_id = it.product_id AND location_id = po.location_id FOR UPDATE;
      _after := coalesce(_before, 0) + _qty;
      UPDATE public.product_stocks SET stock = _after WHERE product_id = it.product_id AND location_id = po.location_id;
    END IF;
    IF p_update_cost AND it.unit_cost > 0 THEN
      UPDATE public.products SET cost_price = it.unit_cost WHERE id = it.product_id;
    END IF;
    INSERT INTO public.stock_adjustments (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
    VALUES (it.product_id, it.variant_id, po.location_id, _qty, coalesce(_before, 0), _after, 'purchase_received', auth.uid());
    UPDATE public.purchase_items SET received_quantity = received_quantity + _qty WHERE id = it.id;
    _lines := _lines + 1;
  END LOOP;
  IF _lines = 0 THEN RAISE EXCEPTION 'Choose at least one item and quantity to receive'; END IF;

  SELECT coalesce(sum(quantity - received_quantity), 0) INTO _left FROM public.purchase_items WHERE purchase_id = p_purchase;
  UPDATE public.purchases SET status = CASE WHEN _left <= 0.0001 THEN 'received' ELSE 'partially_received' END,
    received_at = now() WHERE id = p_purchase;
  PERFORM public._purchase_bill(p_purchase);
  RETURN jsonb_build_object('lines', _lines, 'status', CASE WHEN _left <= 0.0001 THEN 'received' ELSE 'partially_received' END, 'remaining', _left);
END $$;
REVOKE ALL ON FUNCTION public.receive_purchase(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase(uuid, jsonb, boolean) TO authenticated;

/** Record a payment on a bill (full or part). Recurring bills move to the next due date once fully paid. */
CREATE OR REPLACE FUNCTION public.record_bill_payment(p_bill uuid, p_amount numeric, p_method text DEFAULT 'cash',
  p_reference text DEFAULT NULL, p_paid_on date DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b public.bills%ROWTYPE; _paid numeric; _due numeric; _name text; _next date;
BEGIN
  SELECT * INTO b FROM public.bills WHERE id = p_bill FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT public._can_manage_purchases(b.tenant_id) THEN
    RAISE EXCEPTION 'You are not allowed to record payments';
  END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Enter an amount above zero'; END IF;
  _due := round(b.amount - b.amount_paid, 2);
  IF _due <= 0 THEN RAISE EXCEPTION 'This bill is already paid'; END IF;
  IF p_amount > _due + 0.009 THEN RAISE EXCEPTION 'That is more than the % still owed', _due; END IF;

  SELECT display_name INTO _name FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.supplier_payments (tenant_id, bill_id, purchase_id, supplier_id, amount, method, reference, paid_on, notes, recorded_by, recorded_by_name)
  VALUES (b.tenant_id, b.id, b.purchase_id, b.supplier_id, round(p_amount, 2), coalesce(nullif(trim(p_method), ''), 'cash'),
          nullif(trim(p_reference), ''), coalesce(p_paid_on, current_date), nullif(trim(p_notes), ''), auth.uid(), _name);

  _paid := round(b.amount_paid + p_amount, 2);
  IF _paid >= b.amount - 0.009 AND b.is_recurring AND b.next_due_date IS NOT NULL THEN
    _next := CASE b.recurrence_unit
      WHEN 'days' THEN b.next_due_date + b.recurrence_interval
      WHEN 'weeks' THEN b.next_due_date + b.recurrence_interval * 7
      WHEN 'years' THEN (b.next_due_date + make_interval(years => b.recurrence_interval))::date
      ELSE (b.next_due_date + make_interval(months => b.recurrence_interval))::date END;
    UPDATE public.bills SET amount_paid = 0, status = 'pending', last_paid_at = now(), next_due_date = _next WHERE id = b.id;
  ELSE
    UPDATE public.bills SET amount_paid = _paid, last_paid_at = now(),
      status = CASE WHEN _paid >= amount - 0.009 THEN 'paid' ELSE 'partial' END WHERE id = b.id;
  END IF;

  IF b.purchase_id IS NOT NULL THEN
    UPDATE public.purchases p SET amount_paid = x.paid,
      payment_status = CASE WHEN x.paid >= x.owed - 0.009 THEN 'paid' WHEN x.paid > 0 THEN 'partial' ELSE 'unpaid' END
      FROM (SELECT coalesce(sum(amount_paid), 0) AS paid, coalesce(sum(amount), 0) AS owed FROM public.bills WHERE purchase_id = b.purchase_id) x
     WHERE p.id = b.purchase_id;
  END IF;
  RETURN jsonb_build_object('paid', _paid, 'remaining', greatest(0, round(b.amount - _paid, 2)));
END $$;
REVOKE ALL ON FUNCTION public.record_bill_payment(uuid, numeric, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_bill_payment(uuid, numeric, text, text, date, text) TO authenticated;

/** "Mark as paid" on a purchase order: pays whatever is still owed on its bill (creating the bill if needed). */
CREATE OR REPLACE FUNCTION public.pay_purchase(p_purchase uuid, p_method text DEFAULT 'cash', p_reference text DEFAULT NULL, p_paid_on date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE po public.purchases%ROWTYPE; _bill uuid; _due numeric;
BEGIN
  SELECT * INTO po FROM public.purchases WHERE id = p_purchase FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT public._can_manage_purchases(po.tenant_id) THEN RAISE EXCEPTION 'You are not allowed to pay suppliers'; END IF;
  _bill := public._purchase_bill(p_purchase);
  SELECT round(amount - amount_paid, 2) INTO _due FROM public.bills WHERE id = _bill;
  IF _due <= 0 THEN RAISE EXCEPTION 'This order is already paid'; END IF;
  RETURN public.record_bill_payment(_bill, _due, p_method, p_reference, p_paid_on, 'Paid from purchase order');
END $$;
REVOKE ALL ON FUNCTION public.pay_purchase(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_purchase(uuid, text, text, date) TO authenticated;

-- Water delivery orders (2026-10-03)
--
-- Customers of a water refill shop get their own account on the shop's
-- ordering page (<shop>.jmsurfpos.co.ke/order). They are NOT Supabase users:
-- the app server (water.js) signs them in with phone + password and talks to
-- these tables with the service key only, so a customer can never reach the
-- staff app or another shop.
--
-- Flow: customer places an order -> reception accepts and assigns a rider ->
-- rider picks up, delivers, then charges (M-Pesa prompt or cash). Charging
-- creates a normal sale (transactions row) for the order; when that sale
-- completes the order closes as paid and the tank is reduced by the usual
-- stock engine.

BEGIN;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS landmark text;

-- Customer sign-in (service role only).
CREATE TABLE IF NOT EXISTS public.customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  phone text NOT NULL,
  password_hash text NOT NULL,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  reset_code_hash text,
  reset_expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone),
  UNIQUE (customer_id)
);
CREATE TABLE IF NOT EXISTS public.customer_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_sessions_account_idx ON public.customer_sessions (account_id);
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_sessions ENABLE ROW LEVEL SECURITY;
-- Staff may see which customers have an online account (not the hashes).
CREATE OR REPLACE VIEW public.customer_accounts_public WITH (security_invoker = false) AS
  SELECT id, tenant_id, customer_id, phone, is_active, last_login_at, created_at
  FROM public.customer_accounts
  WHERE tenant_id = public.current_user_tenant_id();
GRANT SELECT ON public.customer_accounts_public TO authenticated;

CREATE TABLE IF NOT EXISTS public.water_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_no integer NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_name text,
  customer_phone text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  litres_total numeric(14,3) NOT NULL DEFAULT 0,
  lat double precision,
  lng double precision,
  address text,
  landmark text,
  notes text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','accepted','assigned','on_the_way','delivered','paid','cancelled')),
  rider_id uuid,
  rider_name text,
  -- Deferred: water_order_charge links the order just before inserting its sale.
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  payment_method text,
  cancel_reason text,
  accepted_at timestamptz,
  assigned_at timestamptz,
  picked_at timestamptz,
  delivered_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_no)
);
CREATE INDEX IF NOT EXISTS water_orders_tenant_idx ON public.water_orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS water_orders_customer_idx ON public.water_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS water_orders_rider_idx ON public.water_orders (rider_id, status);
CREATE INDEX IF NOT EXISTS water_orders_tx_idx ON public.water_orders (transaction_id);

CREATE TABLE IF NOT EXISTS public.water_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.water_orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  status text NOT NULL,
  note text,
  by_user uuid,
  by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS water_order_events_order_idx ON public.water_order_events (order_id, created_at);

ALTER TABLE public.water_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_order_events ENABLE ROW LEVEL SECURITY;
-- Staff read their shop's orders; riders only the ones given to them. All
-- changes go through the functions below.
DROP POLICY IF EXISTS water_orders_select ON public.water_orders;
CREATE POLICY water_orders_select ON public.water_orders FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id()
         AND (NOT public.has_role(auth.uid(), 'rider') OR rider_id = auth.uid()
              OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'cashier'))
         OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS water_order_events_select ON public.water_order_events;
CREATE POLICY water_order_events_select ON public.water_order_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.water_orders o WHERE o.id = order_id));

CREATE OR REPLACE FUNCTION public.water_staff_name(p_uid uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce(nullif(display_name, ''), 'Staff') FROM public.profiles WHERE user_id = p_uid LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.water_staff_name(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.water_order_log(p_order public.water_orders, p_note text, p_uid uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  INSERT INTO public.water_order_events (order_id, tenant_id, status, note, by_user, by_name)
  VALUES (p_order.id, p_order.tenant_id, p_order.status, p_note, p_uid,
          CASE WHEN p_uid IS NULL THEN 'Customer' ELSE public.water_staff_name(p_uid) END)
$$;
REVOKE EXECUTE ON FUNCTION public.water_order_log(public.water_orders, text, uuid) FROM PUBLIC, anon, authenticated;

-- Places an order for a customer (called by the app server for the customer
-- portal, service role only). Prices and litres always come from the shop's
-- products, never from the browser. p_items: [{product_id, quantity}].
CREATE OR REPLACE FUNCTION public.water_place_order(p_tenant uuid, p_customer uuid, p_items jsonb,
  p_lat double precision, p_lng double precision, p_address text, p_landmark text, p_notes text)
 RETURNS public.water_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  c public.customers; o public.water_orders; line jsonb; pr record; q integer;
  lines jsonb := '[]'::jsonb; sub numeric := 0; lit numeric := 0; next_no integer;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer AND tenant_id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Choose what you want delivered';
  END IF;
  IF jsonb_array_length(p_items) > 30 THEN RAISE EXCEPTION 'Too many lines'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    q := coalesce(nullif(line->>'quantity', '')::integer, 0);
    IF q <= 0 THEN CONTINUE; END IF;
    IF q > 500 THEN RAISE EXCEPTION 'Quantity too large'; END IF;
    SELECT id, name, price, litres, tank_id INTO pr FROM public.products
      WHERE id = (line->>'product_id')::uuid AND tenant_id = p_tenant AND is_active AND litres IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'An item is no longer available. Refresh and try again.'; END IF;
    lines := lines || jsonb_build_object('product_id', pr.id, 'name', pr.name, 'litres', pr.litres,
      'tank_id', pr.tank_id, 'price', pr.price, 'quantity', q);
    sub := sub + pr.price * q;
    lit := lit + pr.litres * q;
  END LOOP;
  IF jsonb_array_length(lines) = 0 THEN RAISE EXCEPTION 'Choose what you want delivered'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Pin your delivery location on the map';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('water_orders:' || p_tenant::text));
  SELECT coalesce(max(order_no), 1000) + 1 INTO next_no FROM public.water_orders WHERE tenant_id = p_tenant;

  INSERT INTO public.water_orders (tenant_id, order_no, customer_id, customer_name, customer_phone, items,
    subtotal, total, litres_total, lat, lng, address, landmark, notes)
  VALUES (p_tenant, next_no, c.id, c.name, c.phone, lines, round(sub, 2), round(sub, 2), round(lit, 3),
    p_lat, p_lng, left(nullif(trim(coalesce(p_address, '')), ''), 300), left(nullif(trim(coalesce(p_landmark, '')), ''), 300),
    left(nullif(trim(coalesce(p_notes, '')), ''), 500))
  RETURNING * INTO o;
  PERFORM public.water_order_log(o, 'Order placed', NULL);

  INSERT INTO public.shop_notifications (tenant_id, kind, title, body, link)
  VALUES (p_tenant, 'order_new', 'New water order #' || o.order_no,
    coalesce(c.name, 'Customer') || ' · ' || trim(to_char(lit, 'FM999G990D###')) || ' L · ' ||
      coalesce(nullif(o.landmark, ''), nullif(o.address, ''), 'pinned location'),
    '/water/orders');
  RETURN o;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_place_order(uuid, uuid, jsonb, double precision, double precision, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.water_place_order(uuid, uuid, jsonb, double precision, double precision, text, text, text) TO service_role;

-- Customer cancels while the shop has not started on it (service role only).
CREATE OR REPLACE FUNCTION public.water_customer_cancel(p_order uuid, p_customer uuid)
 RETURNS public.water_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE o public.water_orders;
BEGIN
  SELECT * INTO o FROM public.water_orders WHERE id = p_order AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status NOT IN ('new', 'accepted') THEN RAISE EXCEPTION 'This order is already on its way. Call the shop to change it.'; END IF;
  UPDATE public.water_orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Cancelled by customer', updated_at = now()
    WHERE id = o.id RETURNING * INTO o;
  PERFORM public.water_order_log(o, 'Cancelled by customer', NULL);
  INSERT INTO public.shop_notifications (tenant_id, kind, title, body, link)
  VALUES (o.tenant_id, 'order_cancelled', 'Order #' || o.order_no || ' cancelled', coalesce(o.customer_name, 'The customer') || ' cancelled it.', '/water/orders');
  RETURN o;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_customer_cancel(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.water_customer_cancel(uuid, uuid) TO service_role;

-- Staff and rider actions on an order.
--   accept | assign (p_rider) | cancel (p_note) : admin, manager, cashier
--   on_the_way | delivered                      : the assigned rider or the above
CREATE OR REPLACE FUNCTION public.water_order_action(p_order uuid, p_action text, p_rider uuid DEFAULT NULL, p_note text DEFAULT NULL)
 RETURNS public.water_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  o public.water_orders; uid uuid := auth.uid(); desk boolean; rname text;
BEGIN
  SELECT * INTO o FROM public.water_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR (o.tenant_id <> public.current_user_tenant_id() AND NOT public.has_role(uid, 'super_admin')) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  desk := public.has_role(uid, 'admin') OR public.has_role(uid, 'manager') OR public.has_role(uid, 'cashier') OR public.has_role(uid, 'super_admin');
  IF NOT desk AND NOT (o.rider_id = uid AND p_action IN ('on_the_way', 'delivered')) THEN
    RAISE EXCEPTION 'You are not allowed to do that';
  END IF;
  IF o.status IN ('paid', 'cancelled') THEN RAISE EXCEPTION 'This order is closed'; END IF;

  IF p_action = 'accept' THEN
    IF o.status <> 'new' THEN RAISE EXCEPTION 'Already accepted'; END IF;
    UPDATE public.water_orders SET status = 'accepted', accepted_at = now() WHERE id = o.id RETURNING * INTO o;
  ELSIF p_action = 'assign' THEN
    IF o.status NOT IN ('new', 'accepted', 'assigned', 'on_the_way') THEN RAISE EXCEPTION 'This order can no longer be reassigned'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.profiles pf ON pf.user_id = ur.user_id
                   WHERE ur.user_id = p_rider AND pf.tenant_id = o.tenant_id) THEN
      RAISE EXCEPTION 'Choose a rider from this shop';
    END IF;
    rname := public.water_staff_name(p_rider);
    UPDATE public.water_orders SET rider_id = p_rider, rider_name = rname,
      status = CASE WHEN status = 'on_the_way' THEN 'on_the_way' ELSE 'assigned' END,
      accepted_at = coalesce(accepted_at, now()), assigned_at = now()
      WHERE id = o.id RETURNING * INTO o;
    p_note := coalesce(p_note, 'Given to ' || rname);
  ELSIF p_action = 'on_the_way' THEN
    IF o.status NOT IN ('assigned', 'accepted') OR o.rider_id IS NULL THEN RAISE EXCEPTION 'Assign a rider first'; END IF;
    UPDATE public.water_orders SET status = 'on_the_way', picked_at = now() WHERE id = o.id RETURNING * INTO o;
  ELSIF p_action = 'delivered' THEN
    IF o.status NOT IN ('assigned', 'on_the_way') THEN RAISE EXCEPTION 'The order is not out for delivery'; END IF;
    UPDATE public.water_orders SET status = 'delivered', delivered_at = now(), picked_at = coalesce(picked_at, now())
      WHERE id = o.id RETURNING * INTO o;
  ELSIF p_action = 'cancel' THEN
    IF NOT desk THEN RAISE EXCEPTION 'You are not allowed to do that'; END IF;
    IF o.transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.transactions WHERE id = o.transaction_id AND status = 'pending') THEN
      RAISE EXCEPTION 'A payment is in progress for this order';
    END IF;
    UPDATE public.water_orders SET status = 'cancelled', cancelled_at = now(),
      cancel_reason = left(nullif(trim(coalesce(p_note, '')), ''), 300) WHERE id = o.id RETURNING * INTO o;
  ELSE
    RAISE EXCEPTION 'Unknown action';
  END IF;
  UPDATE public.water_orders SET updated_at = now() WHERE id = o.id;
  PERFORM public.water_order_log(o, p_note, uid);
  RETURN o;
END $$;
REVOKE ALL ON FUNCTION public.water_order_action(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_order_action(uuid, text, uuid, text) TO authenticated;

-- Charges a delivered order: creates the sale for it. M-Pesa sales start
-- pending (the app then sends the prompt with the usual payment route);
-- cash sales complete at once. Returns the sale id.
CREATE OR REPLACE FUNCTION public.water_order_charge(p_order uuid, p_method text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  o public.water_orders; uid uuid := auth.uid(); desk boolean; tx_id uuid; old_tx public.transactions;
  loc uuid; items jsonb := '[]'::jsonb; line jsonb; tk public.water_tanks; whole numeric; provider text;
BEGIN
  SELECT * INTO o FROM public.water_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.tenant_id <> public.current_user_tenant_id() THEN RAISE EXCEPTION 'Order not found'; END IF;
  desk := public.has_role(uid, 'admin') OR public.has_role(uid, 'manager') OR public.has_role(uid, 'cashier');
  IF NOT desk AND o.rider_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'You are not allowed to do that'; END IF;
  IF o.status IN ('paid', 'cancelled') THEN RAISE EXCEPTION 'This order is closed'; END IF;
  IF o.status NOT IN ('on_the_way', 'delivered', 'assigned') THEN RAISE EXCEPTION 'Deliver the order first'; END IF;
  IF p_method NOT IN ('mpesa', 'cash') THEN RAISE EXCEPTION 'Choose M-Pesa or cash'; END IF;

  -- One live sale per order: reuse a pending M-Pesa sale, retire a failed one.
  IF o.transaction_id IS NOT NULL THEN
    SELECT * INTO old_tx FROM public.transactions WHERE id = o.transaction_id;
    IF FOUND AND old_tx.status = 'completed' THEN RAISE EXCEPTION 'This order is already paid'; END IF;
    IF FOUND AND old_tx.status = 'pending' AND p_method = 'mpesa' THEN
      RETURN jsonb_build_object('transaction_id', old_tx.id, 'total', old_tx.total, 'resumed', true);
    END IF;
    IF FOUND AND old_tx.status = 'pending' THEN
      UPDATE public.transactions SET status = 'cancelled', mpesa_error_message = 'Paid another way'
        WHERE id = old_tx.id AND status = 'pending';
    END IF;
  END IF;

  FOR line IN SELECT value FROM jsonb_array_elements(o.items) LOOP
    SELECT * INTO tk FROM public.water_tanks WHERE id = nullif(line->>'tank_id', '')::uuid;
    IF loc IS NULL AND tk.location_id IS NOT NULL THEN loc := tk.location_id; END IF;
    items := items || (line || jsonb_build_object(
      'id', line->>'product_id', 'unit_type', 'unit', 'stock_per_unit', 1, 'is_service', false, 'vat_rate', 0,
      'cost_price', round(coalesce(tk.cost_per_litre, 0) * (line->>'litres')::numeric, 2), 'price_mode', 'retail'));
  END LOOP;
  IF loc IS NULL THEN
    SELECT id INTO loc FROM public.locations WHERE tenant_id = o.tenant_id AND is_active ORDER BY is_main DESC, created_at LIMIT 1;
  END IF;
  -- M-Pesa takes whole shillings: round down, the difference is a discount.
  whole := CASE WHEN p_method = 'mpesa' THEN floor(o.total) ELSE o.total END;
  SELECT payment_provider INTO provider FROM public.business_settings WHERE tenant_id = o.tenant_id LIMIT 1;

  -- Link first: a cash sale completes on insert and the order follows it.
  tx_id := gen_random_uuid();
  UPDATE public.water_orders SET transaction_id = tx_id, payment_method = p_method,
    status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
    WHERE id = o.id RETURNING * INTO o;
  PERFORM public.water_order_log(o, CASE WHEN p_method = 'cash' THEN 'Cash received' ELSE 'M-Pesa prompt requested' END, uid);

  INSERT INTO public.transactions (id, items, subtotal, tax, discount, total, payment_method, customer_id, customer_name,
    cashier_id, cashier_name, status, location_id, tenant_id, stock_by_server, mpesa_ref)
  VALUES (tx_id, items, o.subtotal, 0, o.subtotal - whole, whole, p_method, o.customer_id, o.customer_name,
    uid, public.water_staff_name(uid), CASE WHEN p_method = 'cash' THEN 'completed' ELSE 'pending' END,
    loc, o.tenant_id, true,
    CASE WHEN p_method = 'mpesa' AND provider = 'jmsurf' THEN 'jmsurf:initiating' END);
  SELECT * INTO o FROM public.water_orders WHERE id = o.id;
  RETURN jsonb_build_object('transaction_id', tx_id, 'total', whole, 'status', o.status, 'phone', o.customer_phone);
END $$;
REVOKE ALL ON FUNCTION public.water_order_charge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_order_charge(uuid, text) TO authenticated;

-- When the order's sale completes (cash at once, M-Pesa when confirmed) the
-- order closes as paid. A failed or cancelled M-Pesa sale leaves it delivered
-- so the rider can try again.
CREATE OR REPLACE FUNCTION public.water_order_follow_sale()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE o public.water_orders;
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    UPDATE public.water_orders SET status = 'paid', paid_at = now(), updated_at = now()
      WHERE transaction_id = NEW.id AND status NOT IN ('paid', 'cancelled')
      RETURNING * INTO o;
    IF FOUND THEN
      PERFORM public.water_order_log(o, 'Paid ' || NEW.total || ' by ' || CASE WHEN NEW.payment_method = 'mpesa' THEN 'M-Pesa' ELSE NEW.payment_method END, NEW.cashier_id);
      INSERT INTO public.shop_notifications (tenant_id, kind, title, body, link)
      VALUES (o.tenant_id, 'order_paid', 'Order #' || o.order_no || ' paid', coalesce(o.customer_name, 'Customer') || ' paid ' || NEW.total || '.', '/water/orders');
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_order_follow_sale() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS water_order_follow_sale ON public.transactions;
CREATE TRIGGER water_order_follow_sale AFTER INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.water_order_follow_sale();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.water_orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

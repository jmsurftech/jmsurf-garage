-- Water refill shops, round 3 (2026-10-03) + support tickets for every shop
--
-- 1. Empty containers (bottles, jerricans) are products with the size they
--    hold in container_litres. The till offers "refill only / with a bottle"
--    and customers can add them to delivery orders.
-- 2. Delivery orders accept containers; the sale made from an order costs
--    containers at their own buying price (refills at the tank's).
-- 3. Tanks get free-text notes.
-- 4. Support tickets: shop staff (riders, cashiers…) and a water shop's online
--    customers open tickets; the shop's admins, managers and cashiers answer.

BEGIN;

-- 1. ------------------------------------------------------------ containers
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS container_litres numeric(8,3)
  CHECK (container_litres IS NULL OR container_litres > 0);
CREATE INDEX IF NOT EXISTS products_container_idx ON public.products (tenant_id, container_litres) WHERE container_litres IS NOT NULL;

-- 2. ------------------------------------------------- orders with containers
CREATE OR REPLACE FUNCTION public.water_place_order(p_tenant uuid, p_customer uuid, p_items jsonb,
  p_lat double precision, p_lng double precision, p_address text, p_landmark text, p_notes text)
 RETURNS public.water_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  c public.customers; o public.water_orders; line jsonb; pr record; q integer;
  lines jsonb := '[]'::jsonb; sub numeric := 0; lit numeric := 0; next_no integer; has_water boolean := false;
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
    SELECT id, name, price, litres, tank_id, container_litres INTO pr FROM public.products
      WHERE id = (line->>'product_id')::uuid AND tenant_id = p_tenant AND is_active
        AND (litres IS NOT NULL OR container_litres IS NOT NULL);
    IF NOT FOUND THEN RAISE EXCEPTION 'An item is no longer available. Refresh and try again.'; END IF;
    lines := lines || jsonb_build_object('product_id', pr.id, 'name', pr.name, 'litres', pr.litres,
      'tank_id', pr.tank_id, 'container_litres', pr.container_litres, 'price', pr.price, 'quantity', q);
    sub := sub + pr.price * q;
    lit := lit + coalesce(pr.litres, 0) * q;
    IF pr.litres IS NOT NULL THEN has_water := true; END IF;
  END LOOP;
  IF jsonb_array_length(lines) = 0 THEN RAISE EXCEPTION 'Choose what you want delivered'; END IF;
  IF NOT has_water THEN RAISE EXCEPTION 'Add at least one refill to the order'; END IF;
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

CREATE OR REPLACE FUNCTION public.water_order_charge(p_order uuid, p_method text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  o public.water_orders; uid uuid := auth.uid(); desk boolean; tx_id uuid; old_tx public.transactions;
  loc uuid; items jsonb := '[]'::jsonb; line jsonb; tk public.water_tanks; whole numeric; provider text; pcost numeric;
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
    IF tk.id IS NOT NULL AND nullif(line->>'litres', '') IS NOT NULL THEN
      pcost := round(coalesce(tk.cost_per_litre, 0) * (line->>'litres')::numeric, 2);
    ELSE
      SELECT coalesce(cost_price, 0) INTO pcost FROM public.products WHERE id = nullif(line->>'product_id', '')::uuid;
      pcost := coalesce(pcost, 0);
    END IF;
    items := items || (line || jsonb_build_object(
      'id', line->>'product_id', 'unit_type', 'unit', 'stock_per_unit', 1, 'is_service', false, 'vat_rate', 0,
      'cost_price', pcost, 'price_mode', 'retail'));
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

-- 3. ----------------------------------------------------------- tank notes
ALTER TABLE public.water_tanks ADD COLUMN IF NOT EXISTS notes text;

-- 4. ------------------------------------------------------ support tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ticket_no integer NOT NULL,
  source text NOT NULL CHECK (source IN ('customer', 'staff')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  created_by uuid,                 -- staff member who opened it (staff tickets)
  created_by_name text,
  order_id uuid REFERENCES public.water_orders(id) ON DELETE SET NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  assigned_to uuid,
  assigned_name text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_by text NOT NULL DEFAULT 'requester' CHECK (last_message_by IN ('requester', 'shop')),
  unread_by_shop boolean NOT NULL DEFAULT true,
  unread_by_requester boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ticket_no)
);
CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx ON public.support_tickets (tenant_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_customer_idx ON public.support_tickets (customer_id);
CREATE INDEX IF NOT EXISTS support_tickets_creator_idx ON public.support_tickets (created_by);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('customer', 'staff', 'system')),
  author_id uuid,
  author_name text,
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false,   -- shop-only note, never shown to the requester
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx ON public.support_ticket_messages (ticket_id, created_at);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- Who answers tickets in a shop.
CREATE OR REPLACE FUNCTION public.ticket_handler(p_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT public.has_role(p_uid, 'admin') OR public.has_role(p_uid, 'manager') OR public.has_role(p_uid, 'cashier')
$$;
REVOKE EXECUTE ON FUNCTION public.ticket_handler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_handler(uuid) TO authenticated;

-- Handlers see the shop's tickets; anyone else sees the ones they opened.
DROP POLICY IF EXISTS support_tickets_select ON public.support_tickets;
CREATE POLICY support_tickets_select ON public.support_tickets FOR SELECT TO authenticated
  USING ((tenant_id = public.current_user_tenant_id() AND (public.ticket_handler(auth.uid()) OR created_by = auth.uid()))
         OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS support_ticket_messages_select ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_select ON public.support_ticket_messages FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() AND EXISTS (
    SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
      AND (public.ticket_handler(auth.uid()) OR (t.created_by = auth.uid() AND NOT internal))));
-- All writes go through the functions below.

CREATE OR REPLACE FUNCTION public.ticket_next_no(p_tenant uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('support_tickets:' || p_tenant::text));
  SELECT coalesce(max(ticket_no), 100) + 1 INTO n FROM public.support_tickets WHERE tenant_id = p_tenant;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.ticket_next_no(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ticket_clean(p text, p_max integer)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT left(nullif(trim(coalesce(p, '')), ''), p_max)
$$;

-- Staff member opens a ticket (rider reporting a problem, cashier logging a
-- customer's phone complaint, …).
CREATE OR REPLACE FUNCTION public.ticket_open(p_subject text, p_body text, p_category text DEFAULT 'general',
  p_priority text DEFAULT 'normal', p_customer uuid DEFAULT NULL, p_order uuid DEFAULT NULL)
 RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE uid uuid := auth.uid(); t uuid := public.current_user_tenant_id(); r public.support_tickets;
  c public.customers; nm text := public.water_staff_name(auth.uid());
BEGIN
  IF uid IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF public.ticket_clean(p_subject, 150) IS NULL THEN RAISE EXCEPTION 'Write a short subject'; END IF;
  IF public.ticket_clean(p_body, 4000) IS NULL THEN RAISE EXCEPTION 'Describe the problem'; END IF;
  IF p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN p_priority := 'normal'; END IF;
  IF p_customer IS NOT NULL THEN
    SELECT * INTO c FROM public.customers WHERE id = p_customer AND tenant_id = t;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  END IF;
  IF p_order IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.water_orders WHERE id = p_order AND tenant_id = t) THEN
    p_order := NULL;
  END IF;
  INSERT INTO public.support_tickets (tenant_id, ticket_no, source, customer_id, customer_name, customer_phone,
    created_by, created_by_name, order_id, subject, category, priority)
  VALUES (t, public.ticket_next_no(t), 'staff', c.id, c.name, c.phone, uid, nm, p_order,
    public.ticket_clean(p_subject, 150), coalesce(public.ticket_clean(p_category, 40), 'general'), p_priority)
  RETURNING * INTO r;
  INSERT INTO public.support_ticket_messages (ticket_id, tenant_id, author_kind, author_id, author_name, body)
  VALUES (r.id, t, 'staff', uid, nm, public.ticket_clean(p_body, 4000));
  IF NOT public.ticket_handler(uid) THEN
    INSERT INTO public.shop_notifications (tenant_id, kind, title, body, link)
    VALUES (t, 'ticket', 'Ticket #' || r.ticket_no || ' from ' || coalesce(nm, 'staff'), r.subject, '/tickets');
  ELSE
    UPDATE public.support_tickets SET unread_by_shop = false WHERE id = r.id RETURNING * INTO r;
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.ticket_open(text, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_open(text, text, text, text, uuid, uuid) TO authenticated;

-- Reply from the shop (handler) or from the staff member who opened it.
CREATE OR REPLACE FUNCTION public.ticket_reply(p_ticket uuid, p_body text, p_internal boolean DEFAULT false, p_status text DEFAULT NULL)
 RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE uid uuid := auth.uid(); r public.support_tickets; handler boolean := public.ticket_handler(auth.uid());
  nm text := public.water_staff_name(auth.uid()); requester boolean;
BEGIN
  SELECT * INTO r FROM public.support_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND OR r.tenant_id <> public.current_user_tenant_id() THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  requester := coalesce(r.created_by = uid, false);
  IF NOT handler AND NOT requester THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF public.ticket_clean(p_body, 4000) IS NULL THEN RAISE EXCEPTION 'Write a message'; END IF;
  IF NOT handler THEN p_internal := false; p_status := NULL; END IF;
  INSERT INTO public.support_ticket_messages (ticket_id, tenant_id, author_kind, author_id, author_name, body, internal)
  VALUES (r.id, r.tenant_id, 'staff', uid, nm, public.ticket_clean(p_body, 4000), coalesce(p_internal, false));
  IF coalesce(p_internal, false) THEN
    UPDATE public.support_tickets SET updated_at = now() WHERE id = r.id RETURNING * INTO r;
  ELSIF handler AND NOT requester THEN
    UPDATE public.support_tickets SET last_message_at = now(), last_message_by = 'shop', unread_by_requester = true,
      unread_by_shop = false,
      status = coalesce(p_status, CASE WHEN status IN ('open', 'resolved', 'closed') THEN 'in_progress' ELSE status END),
      resolved_at = CASE WHEN p_status IN ('resolved', 'closed') THEN now() ELSE resolved_at END,
      assigned_to = coalesce(assigned_to, uid), assigned_name = coalesce(assigned_name, nm), updated_at = now()
     WHERE id = r.id RETURNING * INTO r;
  ELSE
    UPDATE public.support_tickets SET last_message_at = now(), last_message_by = 'requester', unread_by_shop = true,
      status = CASE WHEN status IN ('resolved', 'closed', 'waiting') THEN 'open' ELSE status END, updated_at = now()
     WHERE id = r.id RETURNING * INTO r;
    INSERT INTO public.shop_notifications (tenant_id, kind, title, body, link)
    VALUES (r.tenant_id, 'ticket', 'New reply on ticket #' || r.ticket_no, r.subject, '/tickets');
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.ticket_reply(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_reply(uuid, text, boolean, text) TO authenticated;

-- Status, priority and who handles it (handlers only).
CREATE OR REPLACE FUNCTION public.ticket_update(p_ticket uuid, p_status text DEFAULT NULL, p_priority text DEFAULT NULL,
  p_assign uuid DEFAULT NULL, p_unassign boolean DEFAULT false)
 RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE uid uuid := auth.uid(); r public.support_tickets; t uuid := public.current_user_tenant_id(); old_status text;
BEGIN
  IF NOT public.ticket_handler(uid) THEN RAISE EXCEPTION 'You are not allowed to do that'; END IF;
  SELECT * INTO r FROM public.support_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND OR r.tenant_id <> t THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'in_progress', 'waiting', 'resolved', 'closed') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  IF p_priority IS NOT NULL AND p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN RAISE EXCEPTION 'Unknown priority'; END IF;
  IF p_assign IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_assign AND tenant_id = t) THEN
    RAISE EXCEPTION 'Choose someone from this shop';
  END IF;
  old_status := r.status;
  UPDATE public.support_tickets SET
    status = coalesce(p_status, status),
    priority = coalesce(p_priority, priority),
    assigned_to = CASE WHEN p_unassign THEN NULL ELSE coalesce(p_assign, assigned_to) END,
    assigned_name = CASE WHEN p_unassign THEN NULL WHEN p_assign IS NOT NULL THEN public.water_staff_name(p_assign) ELSE assigned_name END,
    resolved_at = CASE WHEN p_status IN ('resolved', 'closed') AND status NOT IN ('resolved', 'closed') THEN now()
                       WHEN p_status IN ('open', 'in_progress', 'waiting') THEN NULL ELSE resolved_at END,
    unread_by_shop = false, updated_at = now()
   WHERE id = r.id RETURNING * INTO r;
  IF p_status IS NOT NULL AND p_status <> old_status THEN
    INSERT INTO public.support_ticket_messages (ticket_id, tenant_id, author_kind, author_id, author_name, body)
    VALUES (r.id, r.tenant_id, 'system', uid, public.water_staff_name(uid),
      'Status changed to ' || replace(p_status, '_', ' '));
    IF p_status IN ('resolved', 'closed') THEN
      UPDATE public.support_tickets SET unread_by_requester = true WHERE id = r.id RETURNING * INTO r;
    END IF;
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.ticket_update(uuid, text, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_update(uuid, text, text, uuid, boolean) TO authenticated;

-- The requester (staff) or a handler has read the latest messages.
CREATE OR REPLACE FUNCTION public.ticket_mark_read(p_ticket uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE uid uuid := auth.uid(); r public.support_tickets;
BEGIN
  SELECT * INTO r FROM public.support_tickets WHERE id = p_ticket AND tenant_id = public.current_user_tenant_id();
  IF NOT FOUND THEN RETURN; END IF;
  IF r.created_by = uid THEN UPDATE public.support_tickets SET unread_by_requester = false WHERE id = r.id AND unread_by_requester; END IF;
  IF public.ticket_handler(uid) AND r.created_by IS DISTINCT FROM uid THEN
    UPDATE public.support_tickets SET unread_by_shop = false WHERE id = r.id AND unread_by_shop;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ticket_mark_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_mark_read(uuid) TO authenticated;

-- Online customers of a water shop (called by the app server, water.js).
CREATE OR REPLACE FUNCTION public.ticket_customer_open(p_tenant uuid, p_customer uuid, p_subject text, p_body text,
  p_category text DEFAULT 'general', p_order uuid DEFAULT NULL)
 RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE r public.support_tickets; c public.customers;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer AND tenant_id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF public.ticket_clean(p_subject, 150) IS NULL THEN RAISE EXCEPTION 'Write a short subject'; END IF;
  IF public.ticket_clean(p_body, 4000) IS NULL THEN RAISE EXCEPTION 'Describe the problem'; END IF;
  IF p_order IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.water_orders WHERE id = p_order AND customer_id = p_customer) THEN
    p_order := NULL;
  END IF;
  INSERT INTO public.support_tickets (tenant_id, ticket_no, source, customer_id, customer_name, customer_phone,
    order_id, subject, category)
  VALUES (p_tenant, public.ticket_next_no(p_tenant), 'customer', c.id, c.name, c.phone, p_order,
    public.ticket_clean(p_subject, 150), coalesce(public.ticket_clean(p_category, 40), 'general'))
  RETURNING * INTO r;
  INSERT INTO public.support_ticket_messages (ticket_id, tenant_id, author_kind, author_name, body)
  VALUES (r.id, p_tenant, 'customer', c.name, public.ticket_clean(p_body, 4000));
  INSERT INTO public.shop_notifications (tenant_id, kind, title, body, link)
  VALUES (p_tenant, 'ticket', 'Ticket #' || r.ticket_no || ' from ' || coalesce(c.name, 'a customer'), r.subject, '/tickets');
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.ticket_customer_open(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_customer_open(uuid, uuid, text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ticket_customer_reply(p_ticket uuid, p_customer uuid, p_body text)
 RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE r public.support_tickets;
BEGIN
  SELECT * INTO r FROM public.support_tickets WHERE id = p_ticket AND customer_id = p_customer AND source = 'customer' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF public.ticket_clean(p_body, 4000) IS NULL THEN RAISE EXCEPTION 'Write a message'; END IF;
  INSERT INTO public.support_ticket_messages (ticket_id, tenant_id, author_kind, author_name, body)
  VALUES (r.id, r.tenant_id, 'customer', r.customer_name, public.ticket_clean(p_body, 4000));
  UPDATE public.support_tickets SET last_message_at = now(), last_message_by = 'requester', unread_by_shop = true,
    unread_by_requester = false,
    status = CASE WHEN status IN ('resolved', 'closed', 'waiting') THEN 'open' ELSE status END, updated_at = now()
   WHERE id = r.id RETURNING * INTO r;
  INSERT INTO public.shop_notifications (tenant_id, kind, title, body, link)
  VALUES (r.tenant_id, 'ticket', 'New reply on ticket #' || r.ticket_no, r.subject, '/tickets');
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.ticket_customer_reply(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_customer_reply(uuid, uuid, text) TO service_role;

-- Live updates for the ticket screens.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

COMMIT;

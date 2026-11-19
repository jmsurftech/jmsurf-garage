-- Water refill shops, round 2 (2026-10-03)
--
-- 1. Refill sizes show real stock everywhere: their branch stock is kept equal
--    to how many refills the tank can still fill (inventory, dashboard, till).
-- 2. Filling a tank records a supplier bill (paid now or owed), so tank
--    purchases appear under Suppliers / Bills like other shops' purchases.
-- 3. Riders share their position while delivering; the customer sees it.
-- 4. Reception can place an order for a customer who phones in.
-- 5. Fuller delivery details on customers.
-- 6. A simple public website per shop (landing page on its own domain).

BEGIN;

-- 1. ------------------------------------------------------------ size stock
CREATE OR REPLACE FUNCTION public.water_sync_sizes(p_tank uuid, p_product uuid DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE tk public.water_tanks; pr record; loc uuid;
BEGIN
  SELECT * INTO tk FROM public.water_tanks WHERE id = p_tank;
  IF NOT FOUND THEN RETURN; END IF;
  loc := tk.location_id;
  IF loc IS NULL THEN
    SELECT id INTO loc FROM public.locations WHERE tenant_id = tk.tenant_id AND is_active ORDER BY is_main DESC, created_at LIMIT 1;
  END IF;
  IF loc IS NULL THEN RETURN; END IF;
  FOR pr IN SELECT id, litres FROM public.products
            WHERE tank_id = p_tank AND litres > 0 AND (p_product IS NULL OR id = p_product) LOOP
    INSERT INTO public.product_stocks (product_id, location_id, stock)
    VALUES (pr.id, loc, CASE WHEN tk.is_active THEN floor(tk.current_l / pr.litres + 1e-9) ELSE 0 END)
    ON CONFLICT (product_id, location_id) DO UPDATE SET stock = EXCLUDED.stock;
    -- Other branches never hold refills of this tank.
    UPDATE public.product_stocks SET stock = 0 WHERE product_id = pr.id AND location_id <> loc AND stock <> 0;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_sync_sizes(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.water_tank_sync_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  PERFORM public.water_sync_sizes(NEW.id);
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_tank_sync_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS water_tank_sync_sizes ON public.water_tanks;
CREATE TRIGGER water_tank_sync_sizes AFTER INSERT OR UPDATE OF current_l, location_id, is_active ON public.water_tanks
  FOR EACH ROW EXECUTE FUNCTION public.water_tank_sync_trigger();

CREATE OR REPLACE FUNCTION public.water_product_sync_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.tank_id IS NOT NULL AND NEW.litres > 0 THEN
    PERFORM public.water_sync_sizes(NEW.tank_id, NEW.id);
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_product_sync_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS water_product_sync_sizes ON public.products;
CREATE TRIGGER water_product_sync_sizes AFTER INSERT OR UPDATE OF tank_id, litres ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.water_product_sync_trigger();

-- The sale engine lowers the size's branch stock, then the tank moves and the
-- sync above sets the exact figure again. Bring existing sizes up to date.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT id FROM public.water_tanks LOOP PERFORM public.water_sync_sizes(t.id); END LOOP;
END $$;

-- 2. ------------------------------------------------- tank purchase = bill
ALTER TABLE public.water_tank_movements ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.water_tank_movements ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS public.water_tank_purchase(uuid, numeric, numeric, text, text);
CREATE OR REPLACE FUNCTION public.water_tank_purchase(p_tank uuid, p_litres numeric, p_cost_per_litre numeric,
  p_supplier text DEFAULT NULL, p_note text DEFAULT NULL, p_supplier_id uuid DEFAULT NULL,
  p_paid boolean DEFAULT false, p_method text DEFAULT 'cash')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE tk public.water_tanks; new_cost numeric; after_l numeric; sup public.suppliers; sup_name text;
  total numeric; bill uuid; mv uuid;
BEGIN
  tk := public.water_can_manage(p_tank);
  IF coalesce(p_litres, 0) <= 0 THEN RAISE EXCEPTION 'Enter the litres bought'; END IF;
  IF coalesce(p_cost_per_litre, -1) < 0 THEN RAISE EXCEPTION 'Enter the buying price per litre'; END IF;
  IF p_supplier_id IS NOT NULL THEN
    SELECT * INTO sup FROM public.suppliers WHERE id = p_supplier_id AND tenant_id = tk.tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose a supplier of this shop'; END IF;
  END IF;
  sup_name := coalesce(sup.name, nullif(trim(coalesce(p_supplier, '')), ''));
  new_cost := CASE WHEN tk.current_l + p_litres > 0
    THEN round((tk.current_l * tk.cost_per_litre + p_litres * p_cost_per_litre) / (tk.current_l + p_litres), 4)
    ELSE p_cost_per_litre END;
  after_l := public.water_tank_move(p_tank, p_litres, 'purchase', p_cost_per_litre,
    sup_name, NULL, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  UPDATE public.water_tanks SET cost_per_litre = new_cost WHERE id = p_tank;
  SELECT id INTO mv FROM public.water_tank_movements WHERE tank_id = p_tank AND kind = 'purchase' ORDER BY created_at DESC LIMIT 1;

  total := round(p_litres * p_cost_per_litre, 2);
  IF total > 0 THEN
    INSERT INTO public.bills (name, category, amount, status, supplier_id, location_id, tenant_id, created_by, notes, next_due_date)
    VALUES ('Water ' || trim(to_char(p_litres, 'FM999G999G990D###')) || ' L into ' || tk.name || coalesce(' - ' || sup_name, ''),
      'Water Purchase', total, 'pending', sup.id, tk.location_id, tk.tenant_id, auth.uid(),
      trim(to_char(p_cost_per_litre, 'FM999G990D00##')) || ' per litre' || coalesce('. ' || nullif(trim(coalesce(p_note, '')), ''), ''),
      current_date)
    RETURNING id INTO bill;
    UPDATE public.water_tank_movements SET supplier_id = sup.id, bill_id = bill WHERE id = mv;
    IF p_paid THEN
      PERFORM public.record_bill_payment(bill, total, coalesce(nullif(p_method, ''), 'cash'), NULL, current_date, 'Paid when the tank was filled');
    END IF;
  END IF;
  RETURN jsonb_build_object('current_l', after_l, 'cost_per_litre', new_cost, 'over_capacity', after_l > tk.capacity_l, 'bill_id', bill, 'total', total);
END $$;
REVOKE ALL ON FUNCTION public.water_tank_purchase(uuid, numeric, numeric, text, text, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_tank_purchase(uuid, numeric, numeric, text, text, uuid, boolean, text) TO authenticated;

-- 3. ------------------------------------------------------- rider position
ALTER TABLE public.water_orders ADD COLUMN IF NOT EXISTS rider_lat double precision;
ALTER TABLE public.water_orders ADD COLUMN IF NOT EXISTS rider_lng double precision;
ALTER TABLE public.water_orders ADD COLUMN IF NOT EXISTS rider_seen_at timestamptz;

CREATE OR REPLACE FUNCTION public.water_rider_ping(p_lat double precision, p_lng double precision)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE n integer;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL OR abs(p_lat) > 90 OR abs(p_lng) > 180 THEN RETURN 0; END IF;
  UPDATE public.water_orders SET rider_lat = p_lat, rider_lng = p_lng, rider_seen_at = now()
   WHERE rider_id = auth.uid() AND status IN ('assigned', 'on_the_way', 'delivered')
     AND tenant_id = public.current_user_tenant_id();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.water_rider_ping(double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_rider_ping(double precision, double precision) TO authenticated;

-- 4. --------------------------------------------- order taken by reception
CREATE OR REPLACE FUNCTION public.water_staff_place_order(p_customer uuid, p_items jsonb,
  p_lat double precision, p_lng double precision, p_address text, p_landmark text, p_notes text)
 RETURNS public.water_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE uid uuid := auth.uid(); t uuid := public.current_user_tenant_id(); o public.water_orders;
BEGIN
  IF NOT (public.has_role(uid, 'admin') OR public.has_role(uid, 'manager') OR public.has_role(uid, 'cashier')) THEN
    RAISE EXCEPTION 'You are not allowed to take orders';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer AND tenant_id = t) THEN
    RAISE EXCEPTION 'Choose a customer of this shop';
  END IF;
  o := public.water_place_order(t, p_customer, p_items, p_lat, p_lng, p_address, p_landmark, p_notes);
  UPDATE public.water_order_events SET by_user = uid, by_name = public.water_staff_name(uid), note = 'Order taken by the shop'
   WHERE order_id = o.id AND status = 'new';
  -- The person taking it is at the desk: no alert needed for them.
  DELETE FROM public.shop_notifications WHERE tenant_id = t AND kind = 'order_new' AND title = 'New water order #' || o.order_no;
  RETURN o;
END $$;
REVOKE ALL ON FUNCTION public.water_staff_place_order(uuid, jsonb, double precision, double precision, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_staff_place_order(uuid, jsonb, double precision, double precision, text, text, text) TO authenticated;

-- 5. -------------------------------------------------- delivery details
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS alt_phone text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS area text;          -- estate / neighbourhood
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS building text;      -- house, apartment, floor, door
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS delivery_notes text;

-- 6. ------------------------------------------------------- shop website
CREATE TABLE IF NOT EXISTS public.shop_sites (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_sites_select ON public.shop_sites;
CREATE POLICY shop_sites_select ON public.shop_sites FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS shop_sites_write ON public.shop_sites;
CREATE POLICY shop_sites_write ON public.shop_sites FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')))
  WITH CHECK (tenant_id = public.current_user_tenant_id() AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')));

COMMIT;

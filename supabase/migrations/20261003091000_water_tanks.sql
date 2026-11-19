-- Water tanks (2026-10-03)
--
-- Water refill shops buy water in bulk (e.g. 5000 L) into tanks and sell it in
-- refill sizes (500ml, 1L, 5L, 10L, 20L). A refill product carries its size in
-- litres and the tank it draws from. Sales and returns keep going through the
-- normal stock engine (apply_sale_stock / process_sale_return write
-- stock_adjustments); a trigger on stock_adjustments moves the litres in the
-- tank, so exchanges, offline sales and M-Pesa settlements all follow.
--
-- When a tank falls to its alert level a shop notification is raised once,
-- and the app server emails / texts the owner (water.js).

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_tanks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT 'Main tank',
  capacity_l numeric(14,3) NOT NULL DEFAULT 5000 CHECK (capacity_l > 0),
  current_l numeric(14,3) NOT NULL DEFAULT 0 CHECK (current_l >= 0),
  alert_level_l numeric(14,3) NOT NULL DEFAULT 500 CHECK (alert_level_l >= 0),
  cost_per_litre numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_per_litre >= 0),
  price_per_litre numeric(14,4) NOT NULL DEFAULT 0 CHECK (price_per_litre >= 0),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  low_alert_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS water_tanks_tenant_idx ON public.water_tanks (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS water_tanks_one_default ON public.water_tanks (tenant_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS public.water_tank_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id uuid NOT NULL REFERENCES public.water_tanks(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('purchase','sale','return','adjust','wastage')),
  litres numeric(14,3) NOT NULL,
  litres_before numeric(14,3) NOT NULL,
  litres_after numeric(14,3) NOT NULL,
  cost_per_litre numeric(14,4),
  total_cost numeric(14,2),
  supplier text,
  product_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS water_tank_movements_tank_idx ON public.water_tank_movements (tank_id, created_at DESC);
CREATE INDEX IF NOT EXISTS water_tank_movements_tenant_idx ON public.water_tank_movements (tenant_id, created_at DESC);

-- In-app notifications for a shop (bell in the sidebar).
CREATE TABLE IF NOT EXISTS public.shop_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  sent_at timestamptz,           -- emailed / texted to the owner by the app server
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_notifications_tenant_idx ON public.shop_notifications (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_notifications_unsent_idx ON public.shop_notifications (created_at) WHERE sent_at IS NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS litres numeric(8,3) CHECK (litres IS NULL OR litres > 0);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tank_id uuid REFERENCES public.water_tanks(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price_auto boolean NOT NULL DEFAULT true;

-- RLS: everyone in the shop reads; admin / manager change tanks.
ALTER TABLE public.water_tanks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_tank_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS water_tanks_select ON public.water_tanks;
CREATE POLICY water_tanks_select ON public.water_tanks FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS water_tanks_write ON public.water_tanks;
CREATE POLICY water_tanks_write ON public.water_tanks FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id()
         AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')))
  WITH CHECK (tenant_id = public.current_user_tenant_id()
         AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')));

-- Movements are written only by the functions below.
DROP POLICY IF EXISTS water_tank_movements_select ON public.water_tank_movements;
CREATE POLICY water_tank_movements_select ON public.water_tank_movements FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS shop_notifications_select ON public.shop_notifications;
CREATE POLICY shop_notifications_select ON public.shop_notifications FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id());
DROP POLICY IF EXISTS shop_notifications_mark_read ON public.shop_notifications;
CREATE POLICY shop_notifications_mark_read ON public.shop_notifications FOR UPDATE TO authenticated
  USING (tenant_id = public.current_user_tenant_id())
  WITH CHECK (tenant_id = public.current_user_tenant_id());

-- Only read_at may be changed by the shop.
CREATE OR REPLACE FUNCTION public.shop_notifications_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
DECLARE r timestamptz := NEW.read_at;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW := OLD;
    NEW.read_at := r;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS shop_notifications_guard ON public.shop_notifications;
CREATE TRIGGER shop_notifications_guard BEFORE UPDATE ON public.shop_notifications
  FOR EACH ROW EXECUTE FUNCTION public.shop_notifications_guard();

-- Low-tank alert: raised once when the level reaches the alert level, re-armed
-- when the tank is filled above it again.
CREATE OR REPLACE FUNCTION public.water_tank_level_alert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.current_l > NEW.alert_level_l THEN
    NEW.low_alert_sent_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    -- A new, still-empty tank is not news.
    NEW.low_alert_sent_at := now();
  ELSIF NEW.low_alert_sent_at IS NULL AND NEW.is_active THEN
    NEW.low_alert_sent_at := now();
    INSERT INTO public.shop_notifications (tenant_id, kind, title, body, link)
    VALUES (NEW.tenant_id, 'tank_low',
      CASE WHEN NEW.current_l <= 0 THEN NEW.name || ' is empty' ELSE NEW.name || ' is running low' END,
      trim(to_char(NEW.current_l, 'FM999G999G990D###')) || ' L left of ' ||
        trim(to_char(NEW.capacity_l, 'FM999G999G990')) || ' L. Refill the tank soon.',
      '/water/tanks');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_tank_level_alert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS water_tank_level_alert ON public.water_tanks;
CREATE TRIGGER water_tank_level_alert BEFORE INSERT OR UPDATE ON public.water_tanks
  FOR EACH ROW EXECUTE FUNCTION public.water_tank_level_alert();

-- Internal: move litres in a tank and log it. Positive = in, negative = out.
CREATE OR REPLACE FUNCTION public.water_tank_move(p_tank uuid, p_litres numeric, p_kind text,
  p_cost numeric DEFAULT NULL, p_supplier text DEFAULT NULL, p_product uuid DEFAULT NULL,
  p_note text DEFAULT NULL, p_by uuid DEFAULT NULL)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE tk public.water_tanks; after_l numeric;
BEGIN
  SELECT * INTO tk FROM public.water_tanks WHERE id = p_tank FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tank not found'; END IF;
  after_l := greatest(0, round(tk.current_l + p_litres, 3));
  UPDATE public.water_tanks SET current_l = after_l WHERE id = p_tank;
  INSERT INTO public.water_tank_movements
    (tank_id, tenant_id, kind, litres, litres_before, litres_after, cost_per_litre, total_cost, supplier, product_id, note, created_by)
  VALUES (p_tank, tk.tenant_id, p_kind, after_l - tk.current_l, tk.current_l, after_l,
    coalesce(p_cost, tk.cost_per_litre),
    round(abs(after_l - tk.current_l) * coalesce(p_cost, tk.cost_per_litre), 2),
    p_supplier, p_product, p_note, p_by);
  RETURN after_l;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_tank_move(uuid, numeric, text, numeric, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.water_can_manage(p_tank uuid)
 RETURNS public.water_tanks LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE tk public.water_tanks;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')) THEN
    RAISE EXCEPTION 'Only an admin or manager can change tanks';
  END IF;
  SELECT * INTO tk FROM public.water_tanks WHERE id = p_tank;
  IF NOT FOUND OR tk.tenant_id <> public.current_user_tenant_id() THEN RAISE EXCEPTION 'Tank not found'; END IF;
  RETURN tk;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_can_manage(uuid) FROM PUBLIC, anon, authenticated;

-- Bulk purchase into a tank; the buying price becomes a weighted average with
-- what is already in the tank.
CREATE OR REPLACE FUNCTION public.water_tank_purchase(p_tank uuid, p_litres numeric, p_cost_per_litre numeric,
  p_supplier text DEFAULT NULL, p_note text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE tk public.water_tanks; new_cost numeric; after_l numeric;
BEGIN
  tk := public.water_can_manage(p_tank);
  IF coalesce(p_litres, 0) <= 0 THEN RAISE EXCEPTION 'Enter the litres bought'; END IF;
  IF coalesce(p_cost_per_litre, -1) < 0 THEN RAISE EXCEPTION 'Enter the buying price per litre'; END IF;
  new_cost := CASE WHEN tk.current_l + p_litres > 0
    THEN round((tk.current_l * tk.cost_per_litre + p_litres * p_cost_per_litre) / (tk.current_l + p_litres), 4)
    ELSE p_cost_per_litre END;
  after_l := public.water_tank_move(p_tank, p_litres, 'purchase', p_cost_per_litre,
    nullif(trim(coalesce(p_supplier, '')), ''), NULL, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  UPDATE public.water_tanks SET cost_per_litre = new_cost WHERE id = p_tank;
  RETURN jsonb_build_object('current_l', after_l, 'cost_per_litre', new_cost,
    'over_capacity', after_l > tk.capacity_l);
END $$;
REVOKE ALL ON FUNCTION public.water_tank_purchase(uuid, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_tank_purchase(uuid, numeric, numeric, text, text) TO authenticated;

-- Wastage (litres out) or a correction / dip reading (signed litres).
CREATE OR REPLACE FUNCTION public.water_tank_adjust(p_tank uuid, p_litres numeric, p_kind text, p_note text DEFAULT NULL)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE tk public.water_tanks;
BEGIN
  tk := public.water_can_manage(p_tank);
  IF p_kind NOT IN ('adjust', 'wastage') THEN RAISE EXCEPTION 'Unknown adjustment'; END IF;
  IF coalesce(p_litres, 0) = 0 THEN RAISE EXCEPTION 'Enter the litres'; END IF;
  IF p_kind = 'wastage' THEN p_litres := -abs(p_litres); END IF;
  RETURN public.water_tank_move(p_tank, p_litres, p_kind, NULL, NULL, NULL,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.water_tank_adjust(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_tank_adjust(uuid, numeric, text, text) TO authenticated;

-- Selling price per litre; refill sizes on automatic pricing follow it.
CREATE OR REPLACE FUNCTION public.water_set_price(p_tank uuid, p_price_per_litre numeric)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE tk public.water_tanks; n integer;
BEGIN
  tk := public.water_can_manage(p_tank);
  IF coalesce(p_price_per_litre, -1) < 0 THEN RAISE EXCEPTION 'Enter the selling price per litre'; END IF;
  UPDATE public.water_tanks SET price_per_litre = p_price_per_litre WHERE id = p_tank;
  UPDATE public.products SET price = round(litres * p_price_per_litre, 2)
    WHERE tank_id = p_tank AND tenant_id = tk.tenant_id AND price_auto AND litres IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.water_set_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_set_price(uuid, numeric) TO authenticated;

-- Sales and returns of refill products move litres in their tank. Both go
-- through stock_adjustments (apply_sale_stock writes 'sale', process_sale_return
-- writes 'return'), so one trigger covers tills, M-Pesa, offline and exchanges.
CREATE OR REPLACE FUNCTION public.water_tank_follow_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE pr record;
BEGIN
  IF NEW.reason NOT IN ('sale', 'return') OR coalesce(NEW.quantity_change, 0) = 0 THEN RETURN NULL; END IF;
  SELECT litres, tank_id INTO pr FROM public.products WHERE id = NEW.product_id;
  IF pr.tank_id IS NULL OR pr.litres IS NULL THEN RETURN NULL; END IF;
  PERFORM public.water_tank_move(pr.tank_id, NEW.quantity_change * pr.litres, NEW.reason,
    NULL, NULL, NEW.product_id, NULL, NEW.adjusted_by);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Never block a sale over the tank figure.
  RAISE WARNING 'water_tank_follow_stock: %', SQLERRM;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.water_tank_follow_stock() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS water_tank_follow_stock ON public.stock_adjustments;
CREATE TRIGGER water_tank_follow_stock AFTER INSERT ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.water_tank_follow_stock();

-- Live updates for the tank page and the bell.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.water_tanks; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shop_notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

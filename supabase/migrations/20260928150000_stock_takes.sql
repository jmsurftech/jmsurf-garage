-- Stock-take (count sheets).
-- start: snapshot what the system expects per product (and size/colour).
-- save:  record what was counted (can be done over several sessions).
-- finish: move stock by (counted - expected), so sales made while counting
--         are not lost, and log each change as a 'stock_take' adjustment.

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  location_id uuid NOT NULL,
  name text NOT NULL,
  category text,
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'completed', 'cancelled')),
  note text,
  created_by uuid, created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid, completed_by_name text,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS stock_counts_tenant_idx ON public.stock_counts (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  variant_id uuid,
  name text NOT NULL,
  barcode text,
  category text,
  expected numeric NOT NULL DEFAULT 0,
  counted numeric,
  unit_cost numeric NOT NULL DEFAULT 0,
  counted_at timestamptz,
  counted_by uuid
);
CREATE INDEX IF NOT EXISTS stock_count_lines_count_idx ON public.stock_count_lines (count_id);

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_counts_read ON public.stock_counts;
CREATE POLICY stock_counts_read ON public.stock_counts FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
DROP POLICY IF EXISTS stock_count_lines_read ON public.stock_count_lines;
CREATE POLICY stock_count_lines_read ON public.stock_count_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_counts c WHERE c.id = count_id
                 AND (c.tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'::public.app_role))));
REVOKE ALL ON public.stock_counts, public.stock_count_lines FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_counts, public.stock_count_lines FROM authenticated;
GRANT SELECT ON public.stock_counts, public.stock_count_lines TO authenticated;

CREATE OR REPLACE FUNCTION public._stock_count_guard(p_count uuid, p_need_counting boolean)
RETURNS public.stock_counts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.stock_counts%ROWTYPE; _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'manager') OR public.has_role(_uid, 'stock_manager') OR public.has_role(_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'Only a manager, stock manager or the owner can do stock-takes';
  END IF;
  SELECT * INTO c FROM public.stock_counts WHERE id = p_count FOR UPDATE;
  IF NOT FOUND OR (c.tenant_id <> public.current_user_tenant_id() AND NOT public.has_role(_uid, 'super_admin')) THEN RAISE EXCEPTION 'Stock-take not found'; END IF;
  IF p_need_counting AND c.status <> 'counting' THEN RAISE EXCEPTION 'This stock-take is already %', c.status; END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public._stock_count_guard(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_stock_count(p_location uuid, p_name text, p_category text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _tenant uuid := public.current_user_tenant_id(); _id uuid; _name text;
BEGIN
  IF _uid IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'manager') OR public.has_role(_uid, 'stock_manager')) THEN
    RAISE EXCEPTION 'Only a manager, stock manager or the owner can do stock-takes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = p_location AND tenant_id = _tenant) THEN RAISE EXCEPTION 'Choose one of your branches'; END IF;
  SELECT display_name INTO _name FROM public.profiles WHERE user_id = _uid;

  INSERT INTO public.stock_counts (tenant_id, location_id, name, category, created_by, created_by_name)
  VALUES (_tenant, p_location, coalesce(nullif(trim(p_name), ''), 'Stock-take ' || to_char(now() AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY')), nullif(p_category, ''), _uid, _name)
  RETURNING id INTO _id;

  -- Products without sizes/colours: branch stock.
  INSERT INTO public.stock_count_lines (count_id, product_id, name, barcode, category, expected, unit_cost)
  SELECT _id, p.id, p.name, p.barcode, p.category, coalesce(ps.stock, 0), coalesce(p.cost_price, 0)
  FROM public.products p
  LEFT JOIN public.product_stocks ps ON ps.product_id = p.id AND ps.location_id = p_location
  WHERE p.tenant_id = _tenant AND coalesce(p.is_active, true)
    AND (p_category IS NULL OR p_category = '' OR p.category = p_category)
    AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id);

  -- Products with sizes/colours: one line per option.
  INSERT INTO public.stock_count_lines (count_id, product_id, variant_id, name, barcode, category, expected, unit_cost)
  SELECT _id, p.id, v.id, p.name || ' — ' || concat_ws(' / ', nullif(v.size, ''), nullif(v.color, '')), coalesce(v.barcode, p.barcode), p.category,
         coalesce(v.stock, 0), coalesce(v.cost_price, p.cost_price, 0)
  FROM public.products p JOIN public.product_variants v ON v.product_id = p.id AND coalesce(v.is_active, true)
  WHERE p.tenant_id = _tenant AND coalesce(p.is_active, true)
    AND (p_category IS NULL OR p_category = '' OR p.category = p_category);

  RETURN _id;
END $$;

-- p_lines: [{ "id": line uuid, "counted": number|null }]
CREATE OR REPLACE FUNCTION public.save_stock_count(p_count uuid, p_lines jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.stock_counts%ROWTYPE; n integer;
BEGIN
  c := public._stock_count_guard(p_count, true);
  UPDATE public.stock_count_lines l SET
    counted = CASE WHEN x.value->>'counted' IS NULL OR x.value->>'counted' = '' THEN NULL ELSE greatest(0, (x.value->>'counted')::numeric) END,
    counted_at = now(), counted_by = auth.uid()
  FROM jsonb_array_elements(p_lines) x
  WHERE l.count_id = c.id AND l.id = (x.value->>'id')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.finish_stock_count(p_count uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.stock_counts%ROWTYPE; l record; cur numeric; nxt numeric; delta numeric;
  changed integer := 0; units numeric := 0; value numeric := 0; _name text;
BEGIN
  c := public._stock_count_guard(p_count, true);
  SELECT display_name INTO _name FROM public.profiles WHERE user_id = auth.uid();
  FOR l IN SELECT * FROM public.stock_count_lines WHERE count_id = c.id AND counted IS NOT NULL AND counted <> expected LOOP
    delta := l.counted - l.expected;
    IF l.variant_id IS NOT NULL THEN
      SELECT stock INTO cur FROM public.product_variants WHERE id = l.variant_id FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      nxt := greatest(0, coalesce(cur, 0) + delta);
      UPDATE public.product_variants SET stock = nxt WHERE id = l.variant_id;
    ELSE
      INSERT INTO public.product_stocks (product_id, location_id, stock) VALUES (l.product_id, c.location_id, 0)
        ON CONFLICT (product_id, location_id) DO NOTHING;
      SELECT stock INTO cur FROM public.product_stocks WHERE product_id = l.product_id AND location_id = c.location_id FOR UPDATE;
      nxt := greatest(0, round(coalesce(cur, 0) + delta, 3));
      UPDATE public.product_stocks SET stock = nxt WHERE product_id = l.product_id AND location_id = c.location_id;
    END IF;
    INSERT INTO public.stock_adjustments (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
    VALUES (l.product_id, l.variant_id, c.location_id, nxt - coalesce(cur, 0), coalesce(cur, 0), nxt, 'stock_take', auth.uid());
    changed := changed + 1; units := units + delta; value := value + delta * l.unit_cost;
  END LOOP;
  UPDATE public.stock_counts SET status = 'completed', completed_at = now(), completed_by = auth.uid(), completed_by_name = _name WHERE id = c.id;
  RETURN jsonb_build_object('changed', changed, 'units', units, 'value', round(value, 2));
END $$;

CREATE OR REPLACE FUNCTION public.cancel_stock_count(p_count uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.stock_counts%ROWTYPE;
BEGIN
  c := public._stock_count_guard(p_count, true);
  UPDATE public.stock_counts SET status = 'cancelled', completed_at = now(), completed_by = auth.uid() WHERE id = c.id;
END $$;

REVOKE ALL ON FUNCTION public.start_stock_count(uuid, text, text), public.save_stock_count(uuid, jsonb),
  public.finish_stock_count(uuid), public.cancel_stock_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_stock_count(uuid, text, text), public.save_stock_count(uuid, jsonb),
  public.finish_stock_count(uuid), public.cancel_stock_count(uuid) TO authenticated;

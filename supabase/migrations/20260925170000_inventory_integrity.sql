-- Branch stock is the source of truth. Keep the legacy product total in sync
-- for reports and screens that still read products.stock directly.
CREATE OR REPLACE FUNCTION public.sync_product_stock_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_product_id uuid;
BEGIN
  v_product_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.product_id ELSE NEW.product_id END;
  UPDATE public.products p SET stock = coalesce((
    SELECT sum(ps.stock) FROM public.product_stocks ps WHERE ps.product_id = v_product_id
  ), 0) WHERE p.id = v_product_id;
  IF TG_OP = 'UPDATE' AND OLD.product_id <> NEW.product_id THEN
    UPDATE public.products p SET stock = coalesce((
      SELECT sum(ps.stock) FROM public.product_stocks ps WHERE ps.product_id = OLD.product_id
    ), 0) WHERE p.id = OLD.product_id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS sync_product_stock_total ON public.product_stocks;
CREATE TRIGGER sync_product_stock_total
  AFTER INSERT OR UPDATE OR DELETE ON public.product_stocks
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock_total();

CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id uuid, p_location_id uuid, p_delta numeric,
  p_reason text, p_variant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_before numeric;
  v_after numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_delta IS NULL OR p_delta = 0 OR abs(p_delta) > 1000000 THEN
    RAISE EXCEPTION 'Invalid stock adjustment';
  END IF;
  IF p_reason NOT IN ('restock','damage','return','count','other') THEN
    RAISE EXCEPTION 'Invalid adjustment reason';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = p_location_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Location does not belong to product shop';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Archived shop stock cannot be adjusted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()
    AND role::text IN ('admin','manager','super_admin')) OR
    (NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND tenant_id = v_tenant)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = 'super_admin')) THEN
    RAISE EXCEPTION 'You cannot adjust this shop stock';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_before FROM public.product_variants
      WHERE id = p_variant_id AND product_id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found'; END IF;
    v_after := v_before + p_delta;
    IF v_after < 0 THEN RAISE EXCEPTION 'Stock cannot go below zero'; END IF;
    UPDATE public.product_variants SET stock = v_after WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_before FROM public.product_stocks
      WHERE product_id = p_product_id AND location_id = p_location_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.product_stocks (product_id, location_id, stock)
        SELECT p_product_id, p_location_id,
          CASE WHEN EXISTS (SELECT 1 FROM public.product_stocks WHERE product_id = p_product_id)
            THEN 0 ELSE greatest(0, coalesce(p.stock, 0)) END
        FROM public.products p WHERE p.id = p_product_id
        ON CONFLICT (product_id, location_id) DO NOTHING;
      SELECT stock INTO v_before FROM public.product_stocks
        WHERE product_id = p_product_id AND location_id = p_location_id FOR UPDATE;
    END IF;
    v_after := v_before + p_delta;
    IF v_after < 0 THEN RAISE EXCEPTION 'Stock cannot go below zero'; END IF;
    UPDATE public.product_stocks SET stock = v_after
      WHERE product_id = p_product_id AND location_id = p_location_id;
  END IF;
  INSERT INTO public.stock_adjustments
    (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
  VALUES (p_product_id, p_variant_id, p_location_id, p_delta, v_before, v_after, p_reason, auth.uid());
  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_product_stock(uuid,uuid,numeric,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(uuid,uuid,numeric,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_product_stock(
  p_product_id uuid, p_location_id uuid, p_expected numeric, p_new numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_before numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_new IS NULL OR p_new < 0 OR p_new > 1000000 THEN RAISE EXCEPTION 'Invalid stock quantity'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = p_location_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Location does not belong to product shop';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Archived shop stock cannot be edited';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()
    AND role::text IN ('admin','manager','super_admin')) OR
    (NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND tenant_id = v_tenant)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = 'super_admin')) THEN
    RAISE EXCEPTION 'You cannot edit this shop stock';
  END IF;
  SELECT stock INTO v_before FROM public.product_stocks
    WHERE product_id = p_product_id AND location_id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.product_stocks (product_id, location_id, stock)
      SELECT p_product_id, p_location_id,
        CASE WHEN EXISTS (SELECT 1 FROM public.product_stocks WHERE product_id = p_product_id)
          THEN 0 ELSE greatest(0, coalesce(p.stock, 0)) END
      FROM public.products p WHERE p.id = p_product_id
      ON CONFLICT (product_id, location_id) DO NOTHING;
    SELECT stock INTO v_before FROM public.product_stocks
      WHERE product_id = p_product_id AND location_id = p_location_id FOR UPDATE;
  END IF;
  IF v_before IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'Stock changed while editing. Reload the product and try again';
  END IF;
  IF v_before = p_new THEN RETURN jsonb_build_object('before', v_before, 'after', p_new); END IF;
  UPDATE public.product_stocks SET stock = p_new
    WHERE product_id = p_product_id AND location_id = p_location_id;
  INSERT INTO public.stock_adjustments
    (product_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
  VALUES (p_product_id, p_location_id, p_new - v_before, v_before, p_new, 'count', auth.uid());
  RETURN jsonb_build_object('before', v_before, 'after', p_new);
END;
$$;
REVOKE ALL ON FUNCTION public.set_product_stock(uuid,uuid,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_stock(uuid,uuid,numeric,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_product_stock(
  p_from_location_id uuid, p_to_location_id uuid, p_items jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_from_name text;
  v_to_name text;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_before numeric;
  v_to_before numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_from_location_id = p_to_location_id THEN RAISE EXCEPTION 'Choose two different locations'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Choose 1 to 100 products';
  END IF;
  SELECT tenant_id, name INTO v_tenant, v_from_name FROM public.locations WHERE id = p_from_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source location not found'; END IF;
  SELECT name INTO v_to_name FROM public.locations WHERE id = p_to_location_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination location is not in this shop'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Archived shop stock cannot be transferred';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()
    AND role::text IN ('admin','manager','super_admin')) OR
    (NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND tenant_id = v_tenant)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = 'super_admin')) THEN
    RAISE EXCEPTION 'You cannot transfer this shop stock';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'product_id' LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 1000000 THEN RAISE EXCEPTION 'Invalid transfer quantity'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'Product does not belong to this shop';
    END IF;
    SELECT stock INTO v_before FROM public.product_stocks
      WHERE product_id = v_product_id AND location_id = p_from_location_id FOR UPDATE;
    IF NOT FOUND OR v_before < v_qty THEN RAISE EXCEPTION 'Insufficient source stock for product %', v_product_id; END IF;
    INSERT INTO public.product_stocks (product_id, location_id, stock)
      VALUES (v_product_id, p_to_location_id, 0)
      ON CONFLICT (product_id, location_id) DO NOTHING;
    SELECT stock INTO v_to_before FROM public.product_stocks
      WHERE product_id = v_product_id AND location_id = p_to_location_id FOR UPDATE;
    UPDATE public.product_stocks SET stock = v_before - v_qty
      WHERE product_id = v_product_id AND location_id = p_from_location_id;
    UPDATE public.product_stocks SET stock = v_to_before + v_qty
      WHERE product_id = v_product_id AND location_id = p_to_location_id;
    INSERT INTO public.stock_adjustments
      (product_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
    VALUES
      (v_product_id, p_from_location_id, -v_qty, v_before, v_before - v_qty, 'Transfer to ' || v_to_name, auth.uid()),
      (v_product_id, p_to_location_id, v_qty, v_to_before, v_to_before + v_qty, 'Transfer from ' || v_from_name, auth.uid());
  END LOOP;
  RETURN jsonb_array_length(p_items);
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_product_stock(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_product_stock(uuid,uuid,jsonb) TO authenticated;

-- Reconcile only active shops; archived stock is intentionally untouched.
UPDATE public.products p SET stock = coalesce((
  SELECT sum(ps.stock) FROM public.product_stocks ps WHERE ps.product_id = p.id
), 0)
WHERE EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p.tenant_id AND t.is_active AND t.deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM public.product_stocks ps WHERE ps.product_id = p.id)
  AND p.stock IS DISTINCT FROM coalesce((
    SELECT sum(ps.stock) FROM public.product_stocks ps WHERE ps.product_id = p.id
  ), 0);
NOTIFY pgrst, 'reload schema';

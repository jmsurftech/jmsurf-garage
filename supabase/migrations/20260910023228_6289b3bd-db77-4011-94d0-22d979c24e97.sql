-- 1. Business type on tenants
DO $$ BEGIN
  CREATE TYPE public.business_type AS ENUM ('general', 'liquor', 'clothing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS business_type public.business_type NOT NULL DEFAULT 'general';

-- 2. Product extensions
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS bottle_size text,
  ADD COLUMN IF NOT EXISTS tot_price numeric,
  ADD COLUMN IF NOT EXISTS tots_per_bottle integer,
  ADD COLUMN IF NOT EXISTS units_per_crate integer,
  ADD COLUMN IF NOT EXISTS crate_deposit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS school text;

-- 3. Product variants
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size text,
  color text,
  sku text,
  barcode text,
  price numeric NOT NULL DEFAULT 0,
  cost_price numeric NOT NULL DEFAULT 0,
  stock numeric NOT NULL DEFAULT 0,
  reorder_level numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "variants tenant access" ON public.product_variants FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS idx_variants_product ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_tenant ON public.product_variants(tenant_id);
CREATE TRIGGER trg_variants_updated BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Variant references on stock-carrying tables
ALTER TABLE public.product_stocks ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'unit';

-- 5. Open bills (liquor tabs)
CREATE TABLE IF NOT EXISTS public.open_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  bill_number text,
  label text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  status text NOT NULL DEFAULT 'open',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  transaction_id uuid,
  opened_by uuid,
  opened_by_name text,
  printed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_bills TO authenticated;
GRANT ALL ON public.open_bills TO service_role;
ALTER TABLE public.open_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open bills tenant access" ON public.open_bills FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS idx_open_bills_tenant_status ON public.open_bills(tenant_id, status, created_at DESC);
CREATE TRIGGER trg_open_bills_updated BEFORE UPDATE ON public.open_bills
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Bill payments (split / part payment)
CREATE TABLE IF NOT EXISTS public.bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bill_id uuid REFERENCES public.open_bills(id) ON DELETE CASCADE,
  transaction_id uuid,
  method text NOT NULL,
  amount numeric NOT NULL,
  reference text,
  received_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bill_payments TO authenticated;
GRANT ALL ON public.bill_payments TO service_role;
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bill payments tenant access" ON public.bill_payments FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON public.bill_payments(bill_id);

-- 7. Uniform bundles
CREATE TABLE IF NOT EXISTS public.product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  school text,
  price numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bundles TO authenticated;
GRANT ALL ON public.product_bundles TO service_role;
ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bundles tenant access" ON public.product_bundles FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
CREATE TRIGGER trg_bundles_updated BEFORE UPDATE ON public.product_bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.product_bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bundle_id uuid NOT NULL REFERENCES public.product_bundles(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bundle_items TO authenticated;
GRANT ALL ON public.product_bundle_items TO service_role;
ALTER TABLE public.product_bundle_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bundle items tenant access" ON public.product_bundle_items FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON public.product_bundle_items(bundle_id);

-- 8. Variant exchanges
CREATE TABLE IF NOT EXISTS public.variant_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  transaction_id uuid,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  from_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  to_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 1,
  price_difference numeric NOT NULL DEFAULT 0,
  reason text,
  status text NOT NULL DEFAULT 'completed',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.variant_exchanges TO authenticated;
GRANT ALL ON public.variant_exchanges TO service_role;
ALTER TABLE public.variant_exchanges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchanges tenant access" ON public.variant_exchanges FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS idx_exchanges_tenant ON public.variant_exchanges(tenant_id, created_at DESC);

-- 9. Layaways
CREATE TABLE IF NOT EXISTS public.layaways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  school text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric NOT NULL DEFAULT 0,
  deposit_paid numeric NOT NULL DEFAULT 0,
  balance numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  due_date date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.layaways TO authenticated;
GRANT ALL ON public.layaways TO service_role;
ALTER TABLE public.layaways ENABLE ROW LEVEL SECURITY;
CREATE POLICY "layaways tenant access" ON public.layaways FOR ALL TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX IF NOT EXISTS idx_layaways_tenant ON public.layaways(tenant_id, status, created_at DESC);
CREATE TRIGGER trg_layaways_updated BEFORE UPDATE ON public.layaways
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10. Registration writes business type
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
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
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

      INSERT INTO public.business_settings (tenant_id, business_name, business_email, business_phone, business_address)
      VALUES (
        _tenant_id,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address'
      );

      INSERT INTO public.subscriptions (
        tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price,
        status, trial_ends_at, current_period_start, current_period_end
      ) VALUES (
        _tenant_id, NULL, 'Free', 'monthly', 999999, 999999, 0,
        'active', NULL, now(), now() + interval '100 years'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Tenant setup failed for user %: %', NEW.id, SQLERRM;
    END;
  ELSIF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cashier') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
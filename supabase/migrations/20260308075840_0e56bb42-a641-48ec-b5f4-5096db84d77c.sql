-- Multi-location + settings foundation
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL DEFAULT 'DukaPoint',
  business_phone TEXT,
  business_email TEXT,
  business_address TEXT,
  tax_pin TEXT,
  default_vat_rate NUMERIC NOT NULL DEFAULT 16,
  receipt_footer TEXT NOT NULL DEFAULT 'Thank you for shopping with us!',
  receipt_header TEXT NOT NULL DEFAULT 'Point of Sale System',
  mpesa_shortcode TEXT,
  mpesa_environment TEXT NOT NULL DEFAULT 'live',
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id)
);

CREATE TABLE IF NOT EXISTS public.product_stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  stock INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, location_id)
);

CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  quantity_change INTEGER NOT NULL,
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_locations_user_id ON public.user_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_locations_location_id ON public.user_locations(location_id);
CREATE INDEX IF NOT EXISTS idx_product_stocks_location_id ON public.product_stocks(location_id);
CREATE INDEX IF NOT EXISTS idx_product_stocks_product_id ON public.product_stocks(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_location_id ON public.stock_adjustments(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product_id ON public.stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_transactions_location_id ON public.transactions(location_id);
CREATE INDEX IF NOT EXISTS idx_shifts_location_id ON public.shifts(location_id);

-- updated_at triggers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_locations_updated_at'
  ) THEN
    CREATE TRIGGER update_locations_updated_at
    BEFORE UPDATE ON public.locations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_business_settings_updated_at'
  ) THEN
    CREATE TRIGGER update_business_settings_updated_at
    BEFORE UPDATE ON public.business_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_product_stocks_updated_at'
  ) THEN
    CREATE TRIGGER update_product_stocks_updated_at
    BEFORE UPDATE ON public.product_stocks
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

-- Seed base location + settings
INSERT INTO public.locations (name, code)
VALUES ('Main Store', 'MAIN')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.business_settings (business_name)
SELECT 'DukaPoint'
WHERE NOT EXISTS (SELECT 1 FROM public.business_settings);

-- Enable RLS
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

-- RLS policies: locations
DROP POLICY IF EXISTS "Authenticated users can view locations" ON public.locations;
CREATE POLICY "Authenticated users can view locations"
ON public.locations FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins and managers can manage locations" ON public.locations;
CREATE POLICY "Admins and managers can manage locations"
ON public.locations FOR ALL
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- RLS policies: business_settings
DROP POLICY IF EXISTS "Authenticated users can view business settings" ON public.business_settings;
CREATE POLICY "Authenticated users can view business settings"
ON public.business_settings FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins and managers can manage business settings" ON public.business_settings;
CREATE POLICY "Admins and managers can manage business settings"
ON public.business_settings FOR ALL
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- RLS policies: user_locations
DROP POLICY IF EXISTS "Authenticated users can view user locations" ON public.user_locations;
CREATE POLICY "Authenticated users can view user locations"
ON public.user_locations FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins and managers can manage user locations" ON public.user_locations;
CREATE POLICY "Admins and managers can manage user locations"
ON public.user_locations FOR ALL
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- RLS policies: product_stocks
DROP POLICY IF EXISTS "Authenticated users can view product stocks" ON public.product_stocks;
CREATE POLICY "Authenticated users can view product stocks"
ON public.product_stocks FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Stock managers can manage product stocks" ON public.product_stocks;
CREATE POLICY "Stock managers can manage product stocks"
ON public.product_stocks FOR ALL
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_role(auth.uid(), 'stock_manager')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_role(auth.uid(), 'stock_manager')
);

-- RLS policies: stock_adjustments
DROP POLICY IF EXISTS "Authenticated users can view stock adjustments" ON public.stock_adjustments;
CREATE POLICY "Authenticated users can view stock adjustments"
ON public.stock_adjustments FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Stock managers can insert stock adjustments" ON public.stock_adjustments;
CREATE POLICY "Stock managers can insert stock adjustments"
ON public.stock_adjustments FOR INSERT
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_role(auth.uid(), 'stock_manager')
);

-- Backfill user location assignments to Main Store
INSERT INTO public.user_locations (user_id, location_id, is_primary)
SELECT p.user_id, l.id, true
FROM public.profiles p
CROSS JOIN public.locations l
WHERE l.name = 'Main Store'
ON CONFLICT (user_id, location_id) DO NOTHING;

-- Backfill product stocks from products table stock values
INSERT INTO public.product_stocks (product_id, location_id, stock, reorder_level)
SELECT p.id, l.id, p.stock, p.reorder_level
FROM public.products p
CROSS JOIN public.locations l
WHERE l.name = 'Main Store'
ON CONFLICT (product_id, location_id) DO NOTHING;

-- Backfill existing shifts/transactions location to Main Store
UPDATE public.transactions t
SET location_id = l.id
FROM public.locations l
WHERE t.location_id IS NULL AND l.name = 'Main Store';

UPDATE public.shifts s
SET location_id = l.id
FROM public.locations l
WHERE s.location_id IS NULL AND l.name = 'Main Store';
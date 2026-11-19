
-- Services table
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  price numeric NOT NULL DEFAULT 0,
  cost_price numeric NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'General',
  vat_rate numeric NOT NULL DEFAULT 16,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view services" ON public.services
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and managers can manage services" ON public.services
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

-- Inventory settings table (replaces localStorage)
CREATE TABLE public.inventory_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_prefix text DEFAULT '',
  categories jsonb NOT NULL DEFAULT '["Beverages","Dairy","Bakery","Meat & Poultry","Fruits & Vegetables","Cereals & Grains","Snacks","Cleaning","Personal Care","Electronics","Stationery","Other"]'::jsonb,
  subcategories jsonb NOT NULL DEFAULT '[]'::jsonb,
  units jsonb NOT NULL DEFAULT '["piece","kg","litre","pack","box","crate","dozen"]'::jsonb,
  default_price numeric DEFAULT 0,
  default_cost_price numeric DEFAULT 0,
  default_stock integer DEFAULT 0,
  default_reorder_level integer DEFAULT 5,
  default_vat_rate numeric DEFAULT 16,
  default_unit text DEFAULT 'piece',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inventory settings" ON public.inventory_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and managers can manage inventory settings" ON public.inventory_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));


ALTER TABLE public.products ADD COLUMN IF NOT EXISTS subcategory text DEFAULT '';

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text DEFAULT '',
  email text DEFAULT '',
  address text DEFAULT '',
  notes text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage suppliers" ON public.suppliers FOR ALL TO authenticated 
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager'));

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);

CREATE TABLE IF NOT EXISTS public.bill_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bill_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view bill categories" ON public.bill_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins managers manage bill categories" ON public.bill_categories FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'));

INSERT INTO public.bill_categories (name) VALUES 
  ('Utilities'), ('Rent'), ('Internet/WiFi'), ('Electricity'), ('Water'), ('Insurance'), ('Subscriptions'), ('Other');

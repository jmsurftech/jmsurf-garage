
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  max_users integer NOT NULL DEFAULT 1,
  price_monthly numeric NOT NULL DEFAULT 0,
  price_quarterly numeric NOT NULL DEFAULT 0,
  price_annually numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_public_select" ON public.plans FOR SELECT USING (true);
CREATE POLICY "plans_super_admin_manage" ON public.plans FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  business_email text,
  business_phone text,
  business_address text,
  industry text,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text,
  owner_user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenants_super_admin" ON public.tenants FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "tenants_owner_select" ON public.tenants FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY "tenants_owner_insert" ON public.tenants FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "tenants_owner_update" ON public.tenants FOR UPDATE TO authenticated USING (owner_user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id),
  plan_name text NOT NULL DEFAULT '',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  max_users integer NOT NULL DEFAULT 2,
  price numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'trial',
  trial_ends_at timestamptz,
  current_period_start timestamptz DEFAULT now(),
  current_period_end timestamptz,
  paused_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs_super_admin" ON public.subscriptions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "subs_owner_select" ON public.subscriptions FOR SELECT TO authenticated USING (tenant_id IN (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));
CREATE POLICY "subs_owner_insert" ON public.subscriptions FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

CREATE TABLE IF NOT EXISTS public.cms_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL UNIQUE,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.cms_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cms_public_select" ON public.cms_content FOR SELECT USING (true);
CREATE POLICY "cms_super_admin_manage" ON public.cms_content FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps_super_admin_read" ON public.platform_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "ps_super_admin_manage" ON public.platform_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.inventory_settings ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

UPDATE public.user_roles SET role = 'super_admin' WHERE role = 'admin';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  IF NEW.raw_user_meta_data->>'registration_type' = 'tenant' THEN
    NULL;
  ELSIF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cashier');
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO public.plans (name, max_users, price_monthly, price_quarterly, price_annually, features) VALUES
('Starter', 2, 500, 1350, 4800, '["POS System","Inventory Management","Basic Reports","Email Support"]'::jsonb),
('Growth', 5, 1000, 2700, 9600, '["Everything in Starter","Multi-location","Advanced Reports","M-Pesa Integration","Priority Support"]'::jsonb),
('Business', 10, 2500, 6750, 24000, '["Everything in Growth","Custom Roles","API Access","Dedicated Support","Data Export"]'::jsonb);

INSERT INTO public.cms_content (section, content) VALUES
('hero', '{"title":"JMSURF POS","subtitle":"The Complete Point of Sale Solution for Modern Businesses","cta":"Get Started Free"}'::jsonb),
('features', '{"items":[{"title":"Point of Sale","desc":"Fast, intuitive POS with touch-optimized interface","icon":"ShoppingCart"},{"title":"Inventory Management","desc":"Track stock across multiple locations in real-time","icon":"Package"},{"title":"M-Pesa Integration","desc":"Accept mobile payments seamlessly","icon":"Smartphone"},{"title":"Reports & Analytics","desc":"Comprehensive sales and financial reports","icon":"BarChart3"},{"title":"Multi-Location","desc":"Manage multiple branches from one dashboard","icon":"MapPin"},{"title":"Staff Management","desc":"Role-based access and shift tracking","icon":"Users"}]}'::jsonb),
('footer', '{"copyright":"© 2026 JMSURF POS. All rights reserved."}'::jsonb);

INSERT INTO public.platform_settings (key, value) VALUES
('general', '{"business_name":"JMSURF POS","support_email":"support@jmsurfpos.com"}'::jsonb),
('smtp', '{"host":"","port":587,"username":"","password":"","from_email":"","from_name":"JMSURF POS"}'::jsonb),
('payment', '{"mpesa":{"enabled":false,"shortcode":"","consumer_key":"","consumer_secret":"","passkey":"","environment":"sandbox","transaction_type":"CustomerPayBillOnline"},"paystack":{"enabled":false,"public_key":"","secret_key":""}}'::jsonb);


-- Fix CRITICAL: business_settings SELECT - add tenant isolation
DROP POLICY IF EXISTS "Authenticated users can view business settings" ON business_settings;
CREATE POLICY "Tenant members can view business settings" ON business_settings
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix CRITICAL: profiles SELECT - add tenant isolation  
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
CREATE POLICY "Users can view tenant profiles" ON profiles
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles p2 WHERE p2.user_id = auth.uid() AND p2.tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR user_id = auth.uid()
);

-- Fix CRITICAL: customers SELECT
DROP POLICY IF EXISTS "Authenticated users can view customers" ON customers;
CREATE POLICY "Tenant members can view customers" ON customers
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix CRITICAL: email_logs SELECT
DROP POLICY IF EXISTS "Authenticated users can view email logs" ON email_logs;
CREATE POLICY "Tenant members can view email logs" ON email_logs
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: invoices SELECT
DROP POLICY IF EXISTS "Auth users can view invoices" ON invoices;
CREATE POLICY "Tenant members can view invoices" ON invoices
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: suppliers SELECT
DROP POLICY IF EXISTS "Auth users can view suppliers" ON suppliers;
CREATE POLICY "Tenant members can view suppliers" ON suppliers
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: shifts SELECT
DROP POLICY IF EXISTS "Authenticated users can view shifts" ON shifts;
CREATE POLICY "Tenant members can view shifts" ON shifts
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: transactions SELECT
DROP POLICY IF EXISTS "Authenticated users can view transactions" ON transactions;
CREATE POLICY "Tenant members can view transactions" ON transactions
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: products SELECT
DROP POLICY IF EXISTS "Authenticated users can view products" ON products;
CREATE POLICY "Tenant members can view products" ON products
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: locations - change public to authenticated + tenant isolation
DROP POLICY IF EXISTS "Authenticated users can view locations" ON locations;
CREATE POLICY "Tenant members can view locations" ON locations
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: product_stocks - change public to authenticated
DROP POLICY IF EXISTS "Authenticated users can view product stocks" ON product_stocks;
CREATE POLICY "Authenticated users can view product stocks" ON product_stocks
FOR SELECT TO authenticated USING (true);

-- Fix: stock_adjustments - change public to authenticated
DROP POLICY IF EXISTS "Authenticated users can view stock adjustments" ON stock_adjustments;
CREATE POLICY "Authenticated users can view stock adjustments" ON stock_adjustments
FOR SELECT TO authenticated USING (true);

-- Fix: user_locations - change public to authenticated
DROP POLICY IF EXISTS "Authenticated users can view user locations" ON user_locations;
CREATE POLICY "Authenticated users can view user locations" ON user_locations
FOR SELECT TO authenticated USING (true);

-- Fix: subscriptions update - restrict to owner/super_admin
DROP POLICY IF EXISTS "subs_member_update" ON subscriptions;
CREATE POLICY "subs_admin_update" ON subscriptions
FOR UPDATE TO authenticated
USING (
  tenant_id IN (SELECT id FROM tenants WHERE owner_user_id = auth.uid())
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: bills SELECT
DROP POLICY IF EXISTS "Auth users can view bills" ON bills;
CREATE POLICY "Tenant members can view bills" ON bills
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: expenses SELECT
DROP POLICY IF EXISTS "Auth users can view expenses" ON expenses;
CREATE POLICY "Tenant members can view expenses" ON expenses
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: purchases SELECT
DROP POLICY IF EXISTS "Auth users can view purchases" ON purchases;
CREATE POLICY "Tenant members can view purchases" ON purchases
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: quotes SELECT
DROP POLICY IF EXISTS "Auth users can view quotes" ON quotes;
CREATE POLICY "Tenant members can view quotes" ON quotes
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Fix: services SELECT
DROP POLICY IF EXISTS "Authenticated users can view services" ON services;
CREATE POLICY "Tenant members can view services" ON services
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Create contact_inquiries table
CREATE TABLE public.contact_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit inquiry" ON contact_inquiries
FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Super admin can manage inquiries" ON contact_inquiries
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

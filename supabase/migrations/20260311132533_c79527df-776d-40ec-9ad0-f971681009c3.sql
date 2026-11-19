-- Fix ALL RLS policies: change from RESTRICTIVE to PERMISSIVE
-- PostgreSQL requires at least one PERMISSIVE policy; with only RESTRICTIVE, everything is denied

-- ===== PRODUCTS =====
DROP POLICY IF EXISTS "Staff can insert products" ON public.products;
DROP POLICY IF EXISTS "Staff can update products" ON public.products;
DROP POLICY IF EXISTS "Staff can delete products" ON public.products;
DROP POLICY IF EXISTS "Tenant members can view products" ON public.products;

CREATE POLICY "Staff can insert products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Staff can update products" ON public.products FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Staff can delete products" ON public.products FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view products" ON public.products FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== CUSTOMERS =====
DROP POLICY IF EXISTS "Staff can insert customers" ON public.customers;
DROP POLICY IF EXISTS "Staff can update customers" ON public.customers;
DROP POLICY IF EXISTS "Staff can delete customers" ON public.customers;
DROP POLICY IF EXISTS "Tenant members can view customers" ON public.customers;

CREATE POLICY "Staff can insert customers" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Staff can update customers" ON public.customers FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Staff can delete customers" ON public.customers FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view customers" ON public.customers FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== SERVICES =====
DROP POLICY IF EXISTS "Staff can manage services" ON public.services;
DROP POLICY IF EXISTS "Tenant members can view services" ON public.services;

CREATE POLICY "Staff can manage services" ON public.services FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view services" ON public.services FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== LOCATIONS =====
DROP POLICY IF EXISTS "Staff can manage locations" ON public.locations;
DROP POLICY IF EXISTS "Tenant members can view locations" ON public.locations;

CREATE POLICY "Staff can manage locations" ON public.locations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view locations" ON public.locations FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== BUSINESS_SETTINGS =====
DROP POLICY IF EXISTS "Staff can manage business settings" ON public.business_settings;
DROP POLICY IF EXISTS "Tenant members can view business settings" ON public.business_settings;

CREATE POLICY "Staff can manage business settings" ON public.business_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view business settings" ON public.business_settings FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== INVENTORY_SETTINGS =====
DROP POLICY IF EXISTS "Authenticated users can view inventory settings" ON public.inventory_settings;
DROP POLICY IF EXISTS "Staff can manage inventory settings" ON public.inventory_settings;

CREATE POLICY "Authenticated users can view inventory settings" ON public.inventory_settings FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Staff can manage inventory settings" ON public.inventory_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));

-- ===== INVOICES =====
DROP POLICY IF EXISTS "Staff can manage invoices" ON public.invoices;
DROP POLICY IF EXISTS "Tenant members can view invoices" ON public.invoices;

CREATE POLICY "Staff can manage invoices" ON public.invoices FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view invoices" ON public.invoices FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== QUOTES =====
DROP POLICY IF EXISTS "Staff can manage quotes" ON public.quotes;
DROP POLICY IF EXISTS "Tenant members can view quotes" ON public.quotes;

CREATE POLICY "Staff can manage quotes" ON public.quotes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view quotes" ON public.quotes FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== SUPPLIERS =====
DROP POLICY IF EXISTS "Staff can manage suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Tenant members can view suppliers" ON public.suppliers;

CREATE POLICY "Staff can manage suppliers" ON public.suppliers FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view suppliers" ON public.suppliers FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== EXPENSES =====
DROP POLICY IF EXISTS "Staff can manage expenses" ON public.expenses;
DROP POLICY IF EXISTS "Tenant members can view expenses" ON public.expenses;

CREATE POLICY "Staff can manage expenses" ON public.expenses FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view expenses" ON public.expenses FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== BILLS =====
DROP POLICY IF EXISTS "Staff can manage bills" ON public.bills;
DROP POLICY IF EXISTS "Tenant members can view bills" ON public.bills;

CREATE POLICY "Staff can manage bills" ON public.bills FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view bills" ON public.bills FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== PURCHASES =====
DROP POLICY IF EXISTS "Staff can manage purchases" ON public.purchases;
DROP POLICY IF EXISTS "Tenant members can view purchases" ON public.purchases;

CREATE POLICY "Staff can manage purchases" ON public.purchases FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view purchases" ON public.purchases FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== SHIFTS =====
DROP POLICY IF EXISTS "Admins can manage all shifts" ON public.shifts;
DROP POLICY IF EXISTS "Staff can start shifts" ON public.shifts;
DROP POLICY IF EXISTS "Staff can update own shifts" ON public.shifts;
DROP POLICY IF EXISTS "Tenant members can view shifts" ON public.shifts;

CREATE POLICY "Admins can manage all shifts" ON public.shifts FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Staff can start shifts" ON public.shifts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Staff can update own shifts" ON public.shifts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Tenant members can view shifts" ON public.shifts FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== PRODUCT_STOCKS =====
DROP POLICY IF EXISTS "Authenticated users can view product stocks" ON public.product_stocks;
DROP POLICY IF EXISTS "Staff can manage product stocks" ON public.product_stocks;

CREATE POLICY "Authenticated users can view product stocks" ON public.product_stocks FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Staff can manage product stocks" ON public.product_stocks FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'));

-- ===== STOCK_ADJUSTMENTS =====
DROP POLICY IF EXISTS "Authenticated users can view stock adjustments" ON public.stock_adjustments;
DROP POLICY IF EXISTS "Staff can insert stock adjustments" ON public.stock_adjustments;

CREATE POLICY "Authenticated users can view stock adjustments" ON public.stock_adjustments FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Staff can insert stock adjustments" ON public.stock_adjustments FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'cashier') OR has_role(auth.uid(), 'super_admin'));

-- ===== PURCHASE_ITEMS =====
DROP POLICY IF EXISTS "Auth users can view purchase items" ON public.purchase_items;
DROP POLICY IF EXISTS "Staff can manage purchase items" ON public.purchase_items;

CREATE POLICY "Auth users can view purchase items" ON public.purchase_items FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Staff can manage purchase items" ON public.purchase_items FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager') OR has_role(auth.uid(), 'super_admin'));

-- ===== EMAIL_LOGS =====
DROP POLICY IF EXISTS "Staff can insert email logs" ON public.email_logs;
DROP POLICY IF EXISTS "Tenant members can view email logs" ON public.email_logs;

CREATE POLICY "Staff can insert email logs" ON public.email_logs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Tenant members can view email logs" ON public.email_logs FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin'));

-- ===== PROFILES =====
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view tenant profiles" ON public.profiles;

CREATE POLICY "Admins can delete profiles" ON public.profiles FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can view tenant profiles" ON public.profiles FOR SELECT TO authenticated
  USING ((tenant_id IN (SELECT p2.tenant_id FROM profiles p2 WHERE p2.user_id = auth.uid() AND p2.tenant_id IS NOT NULL)) OR has_role(auth.uid(), 'super_admin') OR (user_id = auth.uid()));

-- ===== ROLE_PERMISSIONS =====
DROP POLICY IF EXISTS "Admins can manage role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Auth users can view role permissions" ON public.role_permissions;

CREATE POLICY "Admins can manage role permissions" ON public.role_permissions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Auth users can view role permissions" ON public.role_permissions FOR SELECT TO authenticated
  USING (true);

-- ===== BILL_CATEGORIES =====
DROP POLICY IF EXISTS "Auth users can view bill categories" ON public.bill_categories;
DROP POLICY IF EXISTS "Staff can manage bill categories" ON public.bill_categories;

CREATE POLICY "Auth users can view bill categories" ON public.bill_categories FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Staff can manage bill categories" ON public.bill_categories FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));

-- ===== EXPENSE_CATEGORIES =====
DROP POLICY IF EXISTS "Auth users can view expense categories" ON public.expense_categories;
DROP POLICY IF EXISTS "Staff can manage expense categories" ON public.expense_categories;

CREATE POLICY "Auth users can view expense categories" ON public.expense_categories FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Staff can manage expense categories" ON public.expense_categories FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));

-- ===== TENANTS =====
DROP POLICY IF EXISTS "Public can lookup tenant by slug" ON public.tenants;
DROP POLICY IF EXISTS "tenants_member_select" ON public.tenants;
DROP POLICY IF EXISTS "tenants_owner_insert" ON public.tenants;
DROP POLICY IF EXISTS "tenants_owner_select" ON public.tenants;
DROP POLICY IF EXISTS "tenants_owner_update" ON public.tenants;
DROP POLICY IF EXISTS "tenants_super_admin" ON public.tenants;

CREATE POLICY "Public can lookup tenant by slug" ON public.tenants FOR SELECT TO anon
  USING (slug IS NOT NULL AND is_active = true);
CREATE POLICY "tenants_member_select" ON public.tenants FOR SELECT TO authenticated
  USING (id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL));
CREATE POLICY "tenants_owner_insert" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "tenants_owner_select" ON public.tenants FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY "tenants_owner_update" ON public.tenants FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY "tenants_super_admin" ON public.tenants FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- ===== SUBSCRIPTIONS =====
DROP POLICY IF EXISTS "subs_admin_update" ON public.subscriptions;
DROP POLICY IF EXISTS "subs_member_select" ON public.subscriptions;
DROP POLICY IF EXISTS "subs_owner_insert" ON public.subscriptions;
DROP POLICY IF EXISTS "subs_owner_select" ON public.subscriptions;
DROP POLICY IF EXISTS "subs_super_admin" ON public.subscriptions;

CREATE POLICY "subs_admin_update" ON public.subscriptions FOR UPDATE TO authenticated
  USING ((tenant_id IN (SELECT tenants.id FROM tenants WHERE tenants.owner_user_id = auth.uid())) OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "subs_member_select" ON public.subscriptions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL));
CREATE POLICY "subs_owner_insert" ON public.subscriptions FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenants.id FROM tenants WHERE tenants.owner_user_id = auth.uid()));
CREATE POLICY "subs_owner_select" ON public.subscriptions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenants.id FROM tenants WHERE tenants.owner_user_id = auth.uid()));
CREATE POLICY "subs_super_admin" ON public.subscriptions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- ===== SUBSCRIPTION_PAYMENTS =====
DROP POLICY IF EXISTS "sp_super_admin" ON public.subscription_payments;
DROP POLICY IF EXISTS "sp_tenant_insert" ON public.subscription_payments;
DROP POLICY IF EXISTS "sp_tenant_select" ON public.subscription_payments;

CREATE POLICY "sp_super_admin" ON public.subscription_payments FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));
CREATE POLICY "sp_tenant_insert" ON public.subscription_payments FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL));
CREATE POLICY "sp_tenant_select" ON public.subscription_payments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.tenant_id IS NOT NULL));

-- ===== CMS_CONTENT =====
DROP POLICY IF EXISTS "cms_public_select" ON public.cms_content;
DROP POLICY IF EXISTS "cms_super_admin_manage" ON public.cms_content;

CREATE POLICY "cms_public_select" ON public.cms_content FOR SELECT TO public
  USING (true);
CREATE POLICY "cms_super_admin_manage" ON public.cms_content FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- ===== CONTACT_INQUIRIES =====
DROP POLICY IF EXISTS "Anyone can submit inquiry" ON public.contact_inquiries;
DROP POLICY IF EXISTS "Super admin can manage inquiries" ON public.contact_inquiries;

CREATE POLICY "Anyone can submit inquiry" ON public.contact_inquiries FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Super admin can manage inquiries" ON public.contact_inquiries FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- ===== PLANS =====
DROP POLICY IF EXISTS "plans_public_select" ON public.plans;
DROP POLICY IF EXISTS "plans_super_admin_manage" ON public.plans;

CREATE POLICY "plans_public_select" ON public.plans FOR SELECT TO public
  USING (true);
CREATE POLICY "plans_super_admin_manage" ON public.plans FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- ===== PLATFORM_SETTINGS =====
DROP POLICY IF EXISTS "ps_super_admin_manage" ON public.platform_settings;
DROP POLICY IF EXISTS "ps_super_admin_read" ON public.platform_settings;

CREATE POLICY "ps_super_admin_manage" ON public.platform_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));
CREATE POLICY "ps_super_admin_read" ON public.platform_settings FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- ===== USER_ROLES - ensure permissive =====
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- ===== USER_LOCATIONS =====
DROP POLICY IF EXISTS "Users can view user_locations" ON public.user_locations;
DROP POLICY IF EXISTS "Admins can manage user_locations" ON public.user_locations;

CREATE POLICY "Users can view user_locations" ON public.user_locations FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admins can manage user_locations" ON public.user_locations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'super_admin'));
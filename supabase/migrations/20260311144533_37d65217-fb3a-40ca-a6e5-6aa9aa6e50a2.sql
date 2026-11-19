
-- ============================================================
-- MASTER FIX: Convert ALL RLS policies from RESTRICTIVE to PERMISSIVE
-- and replace profiles subqueries with current_user_tenant_id()
-- ============================================================

-- ==================== PROFILES ====================
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view tenant profiles" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'super_admin'::app_role) OR (tenant_id IS NOT NULL AND tenant_id = current_user_tenant_id()));

CREATE POLICY "profiles_insert" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles_update" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "profiles_delete" ON public.profiles AS PERMISSIVE FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== TENANTS ====================
DROP POLICY IF EXISTS "Public can lookup tenant by slug" ON public.tenants;
DROP POLICY IF EXISTS "tenants_member_select" ON public.tenants;
DROP POLICY IF EXISTS "tenants_owner_insert" ON public.tenants;
DROP POLICY IF EXISTS "tenants_owner_select" ON public.tenants;
DROP POLICY IF EXISTS "tenants_owner_update" ON public.tenants;
DROP POLICY IF EXISTS "tenants_super_admin" ON public.tenants;

CREATE POLICY "tenants_anon_slug" ON public.tenants AS PERMISSIVE FOR SELECT TO anon
USING (slug IS NOT NULL AND is_active = true);

CREATE POLICY "tenants_select" ON public.tenants AS PERMISSIVE FOR SELECT TO authenticated
USING (id = current_user_tenant_id() OR owner_user_id = auth.uid() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "tenants_insert" ON public.tenants AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (owner_user_id = auth.uid() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "tenants_update" ON public.tenants AS PERMISSIVE FOR UPDATE TO authenticated
USING (owner_user_id = auth.uid() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "tenants_delete" ON public.tenants AS PERMISSIVE FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== USER_ROLES ====================
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_manage" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "user_roles_select" ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "user_roles_manage" ON public.user_roles AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== PRODUCTS ====================
DROP POLICY IF EXISTS "Tenant members can view products" ON public.products;
DROP POLICY IF EXISTS "Staff can insert products" ON public.products;
DROP POLICY IF EXISTS "Staff can update products" ON public.products;
DROP POLICY IF EXISTS "Staff can delete products" ON public.products;

CREATE POLICY "products_select" ON public.products AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "products_insert" ON public.products AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "products_update" ON public.products AS PERMISSIVE FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "products_delete" ON public.products AS PERMISSIVE FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== CUSTOMERS ====================
DROP POLICY IF EXISTS "Tenant members can view customers" ON public.customers;
DROP POLICY IF EXISTS "Staff can insert customers" ON public.customers;
DROP POLICY IF EXISTS "Staff can update customers" ON public.customers;
DROP POLICY IF EXISTS "Staff can delete customers" ON public.customers;

CREATE POLICY "customers_select" ON public.customers AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "customers_insert" ON public.customers AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "customers_update" ON public.customers AS PERMISSIVE FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "customers_delete" ON public.customers AS PERMISSIVE FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== LOCATIONS ====================
DROP POLICY IF EXISTS "Tenant members can view locations" ON public.locations;
DROP POLICY IF EXISTS "Staff can manage locations" ON public.locations;

CREATE POLICY "locations_select" ON public.locations AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "locations_manage" ON public.locations AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== BUSINESS_SETTINGS ====================
DROP POLICY IF EXISTS "Tenant members can view business settings" ON public.business_settings;
DROP POLICY IF EXISTS "Staff can manage business settings" ON public.business_settings;

CREATE POLICY "biz_settings_select" ON public.business_settings AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "biz_settings_manage" ON public.business_settings AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== INVENTORY_SETTINGS ====================
DROP POLICY IF EXISTS "Authenticated users can view inventory settings" ON public.inventory_settings;
DROP POLICY IF EXISTS "Staff can manage inventory settings" ON public.inventory_settings;

CREATE POLICY "inv_settings_select" ON public.inventory_settings AS PERMISSIVE FOR SELECT TO authenticated USING (true);

CREATE POLICY "inv_settings_manage" ON public.inventory_settings AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== TRANSACTIONS ====================
DROP POLICY IF EXISTS "Tenant members can view transactions" ON public.transactions;
DROP POLICY IF EXISTS "Staff can manage transactions" ON public.transactions;
DROP POLICY IF EXISTS "Staff can insert transactions" ON public.transactions;
DROP POLICY IF EXISTS "Staff can update transactions" ON public.transactions;

CREATE POLICY "transactions_select" ON public.transactions AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "transactions_manage" ON public.transactions AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== SERVICES ====================
DROP POLICY IF EXISTS "Tenant members can view services" ON public.services;
DROP POLICY IF EXISTS "Staff can manage services" ON public.services;

CREATE POLICY "services_select" ON public.services AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "services_manage" ON public.services AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== INVOICES ====================
DROP POLICY IF EXISTS "Tenant members can view invoices" ON public.invoices;
DROP POLICY IF EXISTS "Staff can manage invoices" ON public.invoices;

CREATE POLICY "invoices_select" ON public.invoices AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "invoices_manage" ON public.invoices AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== QUOTES ====================
DROP POLICY IF EXISTS "Tenant members can view quotes" ON public.quotes;
DROP POLICY IF EXISTS "Staff can manage quotes" ON public.quotes;

CREATE POLICY "quotes_select" ON public.quotes AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "quotes_manage" ON public.quotes AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== SUPPLIERS ====================
DROP POLICY IF EXISTS "Tenant members can view suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Staff can manage suppliers" ON public.suppliers;

CREATE POLICY "suppliers_select" ON public.suppliers AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "suppliers_manage" ON public.suppliers AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== EXPENSES ====================
DROP POLICY IF EXISTS "Tenant members can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Staff can manage expenses" ON public.expenses;

CREATE POLICY "expenses_select" ON public.expenses AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "expenses_manage" ON public.expenses AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== BILLS ====================
DROP POLICY IF EXISTS "Tenant members can view bills" ON public.bills;
DROP POLICY IF EXISTS "Staff can manage bills" ON public.bills;

CREATE POLICY "bills_select" ON public.bills AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "bills_manage" ON public.bills AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== SHIFTS ====================
DROP POLICY IF EXISTS "Tenant members can view shifts" ON public.shifts;
DROP POLICY IF EXISTS "Admins can manage all shifts" ON public.shifts;
DROP POLICY IF EXISTS "Staff can start shifts" ON public.shifts;
DROP POLICY IF EXISTS "Staff can update own shifts" ON public.shifts;

CREATE POLICY "shifts_select" ON public.shifts AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "shifts_insert" ON public.shifts AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "shifts_update" ON public.shifts AS PERMISSIVE FOR UPDATE TO authenticated
USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "shifts_delete" ON public.shifts AS PERMISSIVE FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== PURCHASES ====================
DROP POLICY IF EXISTS "Tenant members can view purchases" ON public.purchases;
DROP POLICY IF EXISTS "Staff can manage purchases" ON public.purchases;

CREATE POLICY "purchases_select" ON public.purchases AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "purchases_manage" ON public.purchases AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== EMAIL_LOGS ====================
DROP POLICY IF EXISTS "Tenant members can view email logs" ON public.email_logs;
DROP POLICY IF EXISTS "Staff can insert email logs" ON public.email_logs;

CREATE POLICY "email_logs_select" ON public.email_logs AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "email_logs_insert" ON public.email_logs AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== SUBSCRIPTIONS ====================
DROP POLICY IF EXISTS "subs_member_select" ON public.subscriptions;
DROP POLICY IF EXISTS "subs_owner_select" ON public.subscriptions;
DROP POLICY IF EXISTS "subs_owner_insert" ON public.subscriptions;
DROP POLICY IF EXISTS "subs_admin_update" ON public.subscriptions;
DROP POLICY IF EXISTS "subs_super_admin" ON public.subscriptions;

CREATE POLICY "subs_select" ON public.subscriptions AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "subs_insert" ON public.subscriptions AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role) OR tenant_id IN (SELECT id FROM tenants WHERE owner_user_id = auth.uid()));

CREATE POLICY "subs_update" ON public.subscriptions AS PERMISSIVE FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role) OR tenant_id IN (SELECT id FROM tenants WHERE owner_user_id = auth.uid()));

CREATE POLICY "subs_delete" ON public.subscriptions AS PERMISSIVE FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== SUBSCRIPTION_PAYMENTS ====================
DROP POLICY IF EXISTS "sp_tenant_select" ON public.subscription_payments;
DROP POLICY IF EXISTS "sp_tenant_insert" ON public.subscription_payments;
DROP POLICY IF EXISTS "sp_super_admin" ON public.subscription_payments;

CREATE POLICY "sp_select" ON public.subscription_payments AS PERMISSIVE FOR SELECT TO authenticated
USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "sp_insert" ON public.subscription_payments AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "sp_update" ON public.subscription_payments AS PERMISSIVE FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "sp_delete" ON public.subscription_payments AS PERMISSIVE FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== BILL_CATEGORIES ====================
DROP POLICY IF EXISTS "Auth users can view bill categories" ON public.bill_categories;
DROP POLICY IF EXISTS "Staff can manage bill categories" ON public.bill_categories;

CREATE POLICY "bill_cats_select" ON public.bill_categories AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "bill_cats_manage" ON public.bill_categories AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== EXPENSE_CATEGORIES ====================
DROP POLICY IF EXISTS "Auth users can view expense categories" ON public.expense_categories;
DROP POLICY IF EXISTS "Staff can manage expense categories" ON public.expense_categories;

CREATE POLICY "exp_cats_select" ON public.expense_categories AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "exp_cats_manage" ON public.expense_categories AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== ROLE_PERMISSIONS ====================
DROP POLICY IF EXISTS "Auth users can view role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Admins can manage role permissions" ON public.role_permissions;

CREATE POLICY "role_perms_select" ON public.role_permissions AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_perms_manage" ON public.role_permissions AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== PRODUCT_STOCKS ====================
DROP POLICY IF EXISTS "Authenticated users can view product stocks" ON public.product_stocks;
DROP POLICY IF EXISTS "Staff can manage product stocks" ON public.product_stocks;

CREATE POLICY "prod_stocks_select" ON public.product_stocks AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "prod_stocks_manage" ON public.product_stocks AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== PURCHASE_ITEMS ====================
DROP POLICY IF EXISTS "Auth users can view purchase items" ON public.purchase_items;
DROP POLICY IF EXISTS "Staff can manage purchase items" ON public.purchase_items;

CREATE POLICY "purch_items_select" ON public.purchase_items AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "purch_items_manage" ON public.purchase_items AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== STOCK_ADJUSTMENTS ====================
DROP POLICY IF EXISTS "Authenticated users can view stock adjustments" ON public.stock_adjustments;
DROP POLICY IF EXISTS "Staff can insert stock adjustments" ON public.stock_adjustments;

CREATE POLICY "stock_adj_select" ON public.stock_adjustments AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "stock_adj_insert" ON public.stock_adjustments AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== USER_LOCATIONS ====================
DROP POLICY IF EXISTS "user_locations_select" ON public.user_locations;
DROP POLICY IF EXISTS "user_locations_manage" ON public.user_locations;

CREATE POLICY "user_locs_select" ON public.user_locations AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_locs_manage" ON public.user_locations AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== CMS_CONTENT ====================
DROP POLICY IF EXISTS "cms_public_select" ON public.cms_content;
DROP POLICY IF EXISTS "cms_super_admin_manage" ON public.cms_content;

CREATE POLICY "cms_select" ON public.cms_content AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "cms_manage" ON public.cms_content AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== CONTACT_INQUIRIES ====================
DROP POLICY IF EXISTS "Anyone can submit inquiry" ON public.contact_inquiries;
DROP POLICY IF EXISTS "Super admin can manage inquiries" ON public.contact_inquiries;

CREATE POLICY "inquiries_insert" ON public.contact_inquiries AS PERMISSIVE FOR INSERT TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "inquiries_manage" ON public.contact_inquiries AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== PLANS ====================
DROP POLICY IF EXISTS "plans_public_select" ON public.plans;
DROP POLICY IF EXISTS "plans_super_admin_manage" ON public.plans;

CREATE POLICY "plans_select" ON public.plans AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "plans_manage" ON public.plans AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== PLATFORM_SETTINGS ====================
DROP POLICY IF EXISTS "ps_super_admin_manage" ON public.platform_settings;
DROP POLICY IF EXISTS "ps_super_admin_read" ON public.platform_settings;

CREATE POLICY "ps_select" ON public.platform_settings AS PERMISSIVE FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "ps_manage" ON public.platform_settings AS PERMISSIVE FOR ALL TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- ==================== RE-ATTACH TRIGGER ====================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

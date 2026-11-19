-- Fix multi-tenant data isolation: every write policy on a tenant-scoped
-- table must require tenant_id = current_user_tenant_id() (super_admin bypass).
-- Previously, write policies only checked roles, which let an admin/manager in
-- one tenant write to another tenant's rows (suppliers leak reported by user).

-- Helper macro pattern: tenant_id = current_user_tenant_id() OR super_admin

-- suppliers
DROP POLICY IF EXISTS suppliers_manage ON public.suppliers;
CREATE POLICY suppliers_manage ON public.suppliers FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'stock_manager'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'stock_manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- bills
DROP POLICY IF EXISTS bills_manage ON public.bills;
CREATE POLICY bills_manage ON public.bills FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- expenses
DROP POLICY IF EXISTS expenses_manage ON public.expenses;
CREATE POLICY expenses_manage ON public.expenses FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- invoices
DROP POLICY IF EXISTS invoices_manage ON public.invoices;
CREATE POLICY invoices_manage ON public.invoices FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'));

-- quotes
DROP POLICY IF EXISTS quotes_manage ON public.quotes;
CREATE POLICY quotes_manage ON public.quotes FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'));

-- purchases
DROP POLICY IF EXISTS purchases_manage ON public.purchases;
CREATE POLICY purchases_manage ON public.purchases FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'stock_manager'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'stock_manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- delivery_notes
DROP POLICY IF EXISTS delivery_notes_manage ON public.delivery_notes;
CREATE POLICY delivery_notes_manage ON public.delivery_notes FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'rider') OR public.has_role(auth.uid(),'sales_person'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'rider') OR public.has_role(auth.uid(),'sales_person'))) OR public.has_role(auth.uid(),'super_admin'));

-- packing_lists
DROP POLICY IF EXISTS packing_lists_manage ON public.packing_lists;
CREATE POLICY packing_lists_manage ON public.packing_lists FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'packaging') OR public.has_role(auth.uid(),'sales_person'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'packaging') OR public.has_role(auth.uid(),'sales_person'))) OR public.has_role(auth.uid(),'super_admin'));

-- locations
DROP POLICY IF EXISTS locations_manage ON public.locations;
CREATE POLICY locations_manage ON public.locations FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- services
DROP POLICY IF EXISTS services_manage ON public.services;
CREATE POLICY services_manage ON public.services FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- inventory_settings
DROP POLICY IF EXISTS inv_settings_manage ON public.inventory_settings;
CREATE POLICY inv_settings_manage ON public.inventory_settings FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- cash_register
DROP POLICY IF EXISTS cash_register_manage ON public.cash_register;
CREATE POLICY cash_register_manage ON public.cash_register FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'));

-- transactions (split policies)
DROP POLICY IF EXISTS transactions_manage ON public.transactions;
CREATE POLICY transactions_manage ON public.transactions FOR ALL TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "Admins can update transactions" ON public.transactions;
CREATE POLICY "Admins can update transactions" ON public.transactions FOR UPDATE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND public.has_role(auth.uid(),'admin')) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND public.has_role(auth.uid(),'admin')) OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "Admins can delete transactions" ON public.transactions;
CREATE POLICY "Admins can delete transactions" ON public.transactions FOR DELETE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND public.has_role(auth.uid(),'admin')) OR public.has_role(auth.uid(),'super_admin'));

-- customers (split policies)
DROP POLICY IF EXISTS customers_insert ON public.customers;
CREATE POLICY customers_insert ON public.customers FOR INSERT TO authenticated
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS customers_update ON public.customers;
CREATE POLICY customers_update ON public.customers FOR UPDATE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS customers_delete ON public.customers;
CREATE POLICY customers_delete ON public.customers FOR DELETE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- products (split policies)
DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert ON public.products FOR INSERT TO authenticated
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products FOR UPDATE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'cashier'))) OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS products_delete ON public.products;
CREATE POLICY products_delete ON public.products FOR DELETE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))) OR public.has_role(auth.uid(),'super_admin'));

-- shifts (user_id scoped, but also tenant)
DROP POLICY IF EXISTS shifts_update ON public.shifts;
CREATE POLICY shifts_update ON public.shifts FOR UPDATE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND ((auth.uid() = user_id) OR public.has_role(auth.uid(),'admin'))) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND ((auth.uid() = user_id) OR public.has_role(auth.uid(),'admin'))) OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS shifts_delete ON public.shifts;
CREATE POLICY shifts_delete ON public.shifts FOR DELETE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND public.has_role(auth.uid(),'admin')) OR public.has_role(auth.uid(),'super_admin'));

-- profiles (own profile only for non-admins; admin scoped to tenant)
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
USING ((auth.uid() = user_id) OR ((tenant_id = public.current_user_tenant_id()) AND public.has_role(auth.uid(),'admin')) OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK ((auth.uid() = user_id) OR ((tenant_id = public.current_user_tenant_id()) AND public.has_role(auth.uid(),'admin')) OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated
USING (((tenant_id = public.current_user_tenant_id()) AND public.has_role(auth.uid(),'admin')) OR public.has_role(auth.uid(),'super_admin'));

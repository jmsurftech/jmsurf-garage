
-- Fix: Cashiers need write access to products, product_stocks, stock_adjustments during POS sales
-- The current policies only allow admin/manager/stock_manager but cashiers process sales too

-- Add cashier to products UPDATE (for stock deduction during sale)
DROP POLICY IF EXISTS "Admins and managers can update products" ON public.products;
CREATE POLICY "Staff can update products"
ON public.products FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role));

-- Add cashier to product_stocks management (for stock deduction during sale)
DROP POLICY IF EXISTS "Stock managers can manage product stocks" ON public.product_stocks;
CREATE POLICY "Staff can manage product stocks"
ON public.product_stocks FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role));

-- Add cashier to stock_adjustments INSERT (for recording sale deductions)
DROP POLICY IF EXISTS "Stock managers can insert stock adjustments" ON public.stock_adjustments;
CREATE POLICY "Staff can insert stock adjustments"
ON public.stock_adjustments FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'stock_manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role));

-- Ensure business_settings can be read by super_admin too
DROP POLICY IF EXISTS "Authenticated users can view business settings" ON public.business_settings;
CREATE POLICY "Authenticated users can view business settings"
ON public.business_settings FOR SELECT TO authenticated
USING (true);

-- Allow super_admin to manage business_settings
DROP POLICY IF EXISTS "Admins and managers can manage business settings" ON public.business_settings;
CREATE POLICY "Admins managers superadmin can manage business settings"
ON public.business_settings FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

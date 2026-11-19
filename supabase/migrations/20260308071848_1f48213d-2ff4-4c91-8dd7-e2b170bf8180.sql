
-- Drop overly permissive policies
DROP POLICY "Authenticated users can insert customers" ON public.customers;
DROP POLICY "Authenticated users can update customers" ON public.customers;
DROP POLICY "Authenticated users can create transactions" ON public.transactions;

-- Replace with role-based policies
CREATE POLICY "Staff can insert customers" ON public.customers FOR INSERT TO authenticated 
WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'manager') OR 
  public.has_role(auth.uid(), 'cashier')
);

CREATE POLICY "Staff can update customers" ON public.customers FOR UPDATE TO authenticated 
USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'manager') OR 
  public.has_role(auth.uid(), 'cashier')
);

CREATE POLICY "Staff can create transactions" ON public.transactions FOR INSERT TO authenticated 
WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'manager') OR 
  public.has_role(auth.uid(), 'cashier')
);

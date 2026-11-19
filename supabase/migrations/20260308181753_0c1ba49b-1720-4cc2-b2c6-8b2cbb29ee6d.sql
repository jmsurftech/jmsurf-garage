-- Fix quotes: all existing policies are RESTRICTIVE but there are no PERMISSIVE ones
-- We need at least one permissive policy for each command type

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Auth users can view quotes" ON public.quotes;
DROP POLICY IF EXISTS "Staff can manage quotes" ON public.quotes;

-- Re-create as PERMISSIVE (default)
CREATE POLICY "Auth users can view quotes"
ON public.quotes FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Staff can manage quotes"
ON public.quotes FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'cashier'::app_role));
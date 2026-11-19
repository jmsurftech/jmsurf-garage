-- Fix recursive RLS policy on profiles that breaks app-wide queries
-- Create security-definer helper to fetch current user's tenant safely
CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1
$$;

-- Replace recursive profiles SELECT policy
DROP POLICY IF EXISTS "Users can view tenant profiles" ON public.profiles;

CREATE POLICY "Users can view tenant profiles"
ON public.profiles
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR (
    tenant_id IS NOT NULL
    AND tenant_id = public.current_user_tenant_id()
  )
);
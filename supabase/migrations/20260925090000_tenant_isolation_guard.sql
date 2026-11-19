-- A profile is the source of current_user_tenant_id(); never let a staff
-- account move itself into another tenant through the public API.
CREATE OR REPLACE FUNCTION public.prevent_profile_tenant_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'super_admin'::public.app_role)
  THEN
    RAISE EXCEPTION 'Profile tenant cannot be changed by a tenant user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_tenant_move ON public.profiles;
CREATE TRIGGER prevent_profile_tenant_move
BEFORE UPDATE OF tenant_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_tenant_move();

-- The old INSERT policy checked staff role but omitted the destination tenant.
DROP POLICY IF EXISTS "Staff can create transactions" ON public.transactions;
CREATE POLICY "Staff can create transactions" ON public.transactions
FOR INSERT TO authenticated
WITH CHECK (
  (tenant_id = public.current_user_tenant_id()
   AND (public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'manager'::public.app_role)
     OR public.has_role(auth.uid(), 'cashier'::public.app_role)))
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);

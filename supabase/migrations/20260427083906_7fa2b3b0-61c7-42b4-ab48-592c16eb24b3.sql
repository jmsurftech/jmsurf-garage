-- Strengthen tenant audit access policies
DROP POLICY IF EXISTS "Admins read tenant activity" ON public.user_activity_log;
DROP POLICY IF EXISTS "Members read own activity" ON public.user_activity_log;
DROP POLICY IF EXISTS "Managers and admins read tenant activity" ON public.user_activity_log;
DROP POLICY IF EXISTS "Members read their own tenant activity" ON public.user_activity_log;

CREATE POLICY "Managers and admins read tenant activity"
  ON public.user_activity_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      tenant_id = public.current_user_tenant_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'manager')
      )
    )
  );

CREATE POLICY "Members read their own tenant activity"
  ON public.user_activity_log
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND user_id = auth.uid()
  );

-- Server-side audit helper for payment callbacks and other trusted backend events
CREATE OR REPLACE FUNCTION public.record_tenant_activity(
  _tenant_id uuid,
  _user_id uuid,
  _user_email text,
  _user_display_name text,
  _action text,
  _entity_type text,
  _entity_id text,
  _description text,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;
  IF NULLIF(trim(_action), '') IS NULL THEN
    RAISE EXCEPTION 'action is required';
  END IF;
  IF NULLIF(trim(_description), '') IS NULL THEN
    RAISE EXCEPTION 'description is required';
  END IF;

  INSERT INTO public.user_activity_log (
    tenant_id, user_id, user_email, user_display_name,
    action, entity_type, entity_id, description, metadata
  ) VALUES (
    _tenant_id, _user_id, _user_email, _user_display_name,
    _action, _entity_type, _entity_id, _description, COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- Product pricing support: existing price remains retail price
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS enable_wholesale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wholesale_price numeric,
  ADD COLUMN IF NOT EXISTS wholesale_min_quantity integer NOT NULL DEFAULT 1;

UPDATE public.products
SET wholesale_min_quantity = 1
WHERE wholesale_min_quantity IS NULL OR wholesale_min_quantity < 1;
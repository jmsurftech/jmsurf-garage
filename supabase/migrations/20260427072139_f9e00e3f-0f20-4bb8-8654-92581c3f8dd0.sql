-- Product batches table for expiry tracking
CREATE TABLE IF NOT EXISTS public.product_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid,
  batch_number text,
  quantity integer NOT NULL DEFAULT 0,
  expiry_date date,
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_batches_tenant ON public.product_batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_product ON public.product_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_expiry ON public.product_batches(expiry_date);

ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pb_select" ON public.product_batches
  FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "pb_manage" ON public.product_batches
  FOR ALL TO authenticated
  USING (
    ((tenant_id = current_user_tenant_id()) AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'manager'::app_role) OR
      has_role(auth.uid(), 'stock_manager'::app_role)
    ))
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    ((tenant_id = current_user_tenant_id()) AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'manager'::app_role) OR
      has_role(auth.uid(), 'stock_manager'::app_role)
    ))
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE TRIGGER trg_product_batches_updated
BEFORE UPDATE ON public.product_batches
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
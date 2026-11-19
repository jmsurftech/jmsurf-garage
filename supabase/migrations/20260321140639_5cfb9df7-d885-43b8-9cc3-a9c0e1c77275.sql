
CREATE TABLE public.packing_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  invoice_id uuid REFERENCES public.invoices(id),
  transaction_id uuid REFERENCES public.transactions(id),
  customer_id uuid REFERENCES public.customers(id),
  customer_name text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  notes text DEFAULT '',
  packed_by uuid,
  packed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.packing_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packing_lists_select" ON public.packing_lists FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "packing_lists_manage" ON public.packing_lists FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'packaging') OR has_role(auth.uid(), 'sales_person') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'packaging') OR has_role(auth.uid(), 'sales_person') OR has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.delivery_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  packing_list_id uuid REFERENCES public.packing_lists(id),
  invoice_id uuid REFERENCES public.invoices(id),
  delivery_number text NOT NULL DEFAULT '',
  customer_id uuid REFERENCES public.customers(id),
  customer_name text NOT NULL DEFAULT '',
  customer_address text DEFAULT '',
  customer_phone text DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  rider_id uuid,
  rider_name text DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  assigned_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  notes text DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_notes_select" ON public.delivery_notes FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "delivery_notes_manage" ON public.delivery_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'rider') OR has_role(auth.uid(), 'sales_person') OR has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'rider') OR has_role(auth.uid(), 'sales_person') OR has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.delivery_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id uuid REFERENCES public.delivery_notes(id) NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id),
  receiver_name text NOT NULL,
  receiver_id_number text NOT NULL,
  receiver_phone text DEFAULT '',
  signature_data text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  location_lat numeric,
  location_lng numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_conf_insert_public" ON public.delivery_confirmations FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "delivery_conf_select" ON public.delivery_confirmations FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'));

-- Also allow anon SELECT for the delivery confirmation page to verify delivery_note exists
CREATE POLICY "delivery_notes_anon_select" ON public.delivery_notes FOR SELECT TO anon
  USING (true);

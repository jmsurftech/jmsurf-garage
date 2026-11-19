
-- Expense categories
CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view expense categories" ON public.expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins/managers manage expense categories" ON public.expense_categories FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'));

-- Purchases (purchase orders)
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text NOT NULL DEFAULT '',
  location_id uuid REFERENCES public.locations(id),
  status text NOT NULL DEFAULT 'draft',
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  received_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view purchases" ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage purchases" ON public.purchases FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager'));

-- Purchase items
CREATE TABLE public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES public.products(id) NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view purchase items" ON public.purchase_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage purchase items" ON public.purchase_items FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'stock_manager'));

-- Expenses
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.expense_categories(id),
  category_name text NOT NULL DEFAULT '',
  description text DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  location_id uuid REFERENCES public.locations(id),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view expenses" ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage expenses" ON public.expenses FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'));

-- Bills (recurring support)
CREATE TABLE public.bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Utilities',
  amount numeric NOT NULL DEFAULT 0,
  location_id uuid REFERENCES public.locations(id),
  is_recurring boolean NOT NULL DEFAULT false,
  recurrence_interval integer DEFAULT 1,
  recurrence_unit text DEFAULT 'months',
  next_due_date date,
  last_paid_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  notes text DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view bills" ON public.bills FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage bills" ON public.bills FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'));

-- Quotes
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL DEFAULT '',
  customer_id uuid REFERENCES public.customers(id),
  customer_name text DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]',
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  valid_until date,
  notes text DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view quotes" ON public.quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage quotes" ON public.quotes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier'));

-- Invoices
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL DEFAULT '',
  customer_id uuid REFERENCES public.customers(id),
  customer_name text DEFAULT '',
  customer_email text DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]',
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  due_date date,
  sent_at timestamptz,
  paid_at timestamptz,
  notes text DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view invoices" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage invoices" ON public.invoices FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'cashier'));

-- Role permissions
CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  permission text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role, permission)
);
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can view role permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage role permissions" ON public.role_permissions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Insert default expense categories
INSERT INTO public.expense_categories (name) VALUES
  ('Rent'), ('Utilities'), ('Salaries'), ('Transport'), ('Supplies'),
  ('Marketing'), ('Maintenance'), ('Insurance'), ('Taxes'), ('Other');

-- Insert default role permissions
INSERT INTO public.role_permissions (role, permission, allowed) VALUES
  ('admin', 'dashboard', true), ('admin', 'pos', true), ('admin', 'inventory', true),
  ('admin', 'inventory_delete', true), ('admin', 'customers', true), ('admin', 'reports', true),
  ('admin', 'staff', true), ('admin', 'settings', true), ('admin', 'purchases', true),
  ('admin', 'expenses', true), ('admin', 'bills', true), ('admin', 'quotes', true),
  ('admin', 'invoices', true), ('admin', 'sales', true),
  ('manager', 'dashboard', true), ('manager', 'pos', true), ('manager', 'inventory', true),
  ('manager', 'inventory_delete', true), ('manager', 'customers', true), ('manager', 'reports', true),
  ('manager', 'staff', true), ('manager', 'settings', true), ('manager', 'purchases', true),
  ('manager', 'expenses', true), ('manager', 'bills', true), ('manager', 'quotes', true),
  ('manager', 'invoices', true), ('manager', 'sales', true),
  ('cashier', 'pos', true), ('cashier', 'sales', true), ('cashier', 'customers', true),
  ('cashier', 'inventory', false), ('cashier', 'inventory_delete', false),
  ('cashier', 'dashboard', false), ('cashier', 'reports', false), ('cashier', 'staff', false),
  ('cashier', 'settings', false), ('cashier', 'purchases', false), ('cashier', 'expenses', false),
  ('cashier', 'bills', false), ('cashier', 'quotes', true), ('cashier', 'invoices', true),
  ('stock_manager', 'dashboard', true), ('stock_manager', 'inventory', true),
  ('stock_manager', 'inventory_delete', false), ('stock_manager', 'purchases', true),
  ('stock_manager', 'pos', false), ('stock_manager', 'customers', false),
  ('stock_manager', 'reports', true), ('stock_manager', 'staff', false),
  ('stock_manager', 'settings', false), ('stock_manager', 'expenses', false),
  ('stock_manager', 'bills', false), ('stock_manager', 'quotes', false),
  ('stock_manager', 'invoices', false), ('stock_manager', 'sales', false);

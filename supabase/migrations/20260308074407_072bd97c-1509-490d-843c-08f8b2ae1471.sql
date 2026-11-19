-- Shifts table for employee shift tracking
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_name text NOT NULL,
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  status text NOT NULL DEFAULT 'active',
  total_sales numeric NOT NULL DEFAULT 0,
  transactions_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view shifts" ON public.shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can start shifts" ON public.shifts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Staff can update own shifts" ON public.shifts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all shifts" ON public.shifts FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Add credit_limit to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0;

-- Enable realtime for shifts
ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
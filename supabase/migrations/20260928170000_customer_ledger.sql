-- Customer account ledger: every payment received against a customer's
-- credit, and every manual credit given, is recorded, and the balance moves in
-- the same step. Credit sales and refunds-to-account already live in
-- transactions (payment_method = 'credit'). Together they make a statement.

CREATE TABLE IF NOT EXISTS public.customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  kind text NOT NULL CHECK (kind IN ('payment', 'credit_given')),
  amount numeric NOT NULL CHECK (amount > 0),
  method text,
  note text,
  balance_after numeric NOT NULL,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_payments_customer_idx ON public.customer_payments (customer_id, created_at DESC);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_payments_read ON public.customer_payments;
CREATE POLICY customer_payments_read ON public.customer_payments FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
REVOKE ALL ON public.customer_payments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.customer_payments FROM authenticated;
GRANT SELECT ON public.customer_payments TO authenticated;

-- p_kind: 'payment' (customer pays, balance goes down) | 'credit_given' (balance goes up)
CREATE OR REPLACE FUNCTION public.record_customer_payment(
  p_customer uuid, p_amount numeric, p_kind text DEFAULT 'payment', p_method text DEFAULT 'cash', p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); c public.customers%ROWTYPE; nb numeric; _name text; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'manager') OR public.has_role(_uid, 'cashier') OR public.has_role(_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'You are not allowed to change customer accounts';
  END IF;
  IF p_kind NOT IN ('payment', 'credit_given') THEN RAISE EXCEPTION 'Unknown entry type'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Enter an amount above zero'; END IF;
  SELECT * INTO c FROM public.customers WHERE id = p_customer FOR UPDATE;
  IF NOT FOUND OR (c.tenant_id <> public.current_user_tenant_id() AND NOT public.has_role(_uid, 'super_admin')) THEN RAISE EXCEPTION 'Customer not found'; END IF;

  IF p_kind = 'payment' THEN
    nb := greatest(0, coalesce(c.balance, 0) - p_amount);
  ELSE
    nb := coalesce(c.balance, 0) + p_amount;
    IF coalesce(c.credit_limit, 0) > 0 AND nb > c.credit_limit THEN
      RAISE EXCEPTION 'That goes over the credit limit of %', c.credit_limit;
    END IF;
  END IF;
  UPDATE public.customers SET balance = nb WHERE id = c.id;

  SELECT display_name INTO _name FROM public.profiles WHERE user_id = _uid;
  INSERT INTO public.customer_payments (tenant_id, customer_id, kind, amount, method, note, balance_after, created_by, created_by_name)
  VALUES (c.tenant_id, c.id, p_kind, round(p_amount, 2), nullif(p_method, ''), nullif(trim(p_note), ''), nb, _uid, _name)
  RETURNING id INTO _id;
  RETURN jsonb_build_object('id', _id, 'balance', nb);
END $$;
REVOKE ALL ON FUNCTION public.record_customer_payment(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid, numeric, text, text, text) TO authenticated;

-- 2026-09-28: an exchange balance that was sent as an M-Pesa prompt can be
-- settled another way (cash, card, bank, M-Pesa paid to the till by hand)
-- when the prompt fails or the customer prefers. Only exchange sales qualify.
CREATE OR REPLACE FUNCTION public.settle_exchange_balance(p_sale_id uuid, p_method text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid(); t public.transactions%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'manager') OR public.has_role(_uid, 'cashier')
          OR public.has_role(_uid, 'sales_person') OR public.has_role(_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'You are not allowed to settle exchanges';
  END IF;
  IF p_method NOT IN ('cash', 'mpesa', 'card', 'bank_transfer') THEN RAISE EXCEPTION 'Choose how the customer paid'; END IF;
  SELECT * INTO t FROM public.transactions WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.sale_returns WHERE exchange_transaction_id = p_sale_id) THEN
    RAISE EXCEPTION 'This is not an exchange sale';
  END IF;
  IF t.tenant_id <> public.current_user_tenant_id() AND NOT public.has_role(_uid, 'super_admin') THEN
    RAISE EXCEPTION 'This sale belongs to another shop';
  END IF;
  IF t.status = 'completed' THEN RETURN 'completed'; END IF;
  IF t.status NOT IN ('pending', 'failed', 'cancelled') THEN RAISE EXCEPTION 'This sale cannot be settled'; END IF;

  -- The sale guard only lets owners finish failed sales; this narrow path is
  -- checked above, so run the update as the database itself.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.transactions
     SET status = 'completed', payment_method = p_method, mpesa_error_message = NULL,
         mpesa_ref = CASE WHEN p_method = 'mpesa' THEN coalesce(mpesa_ref, 'manual') ELSE mpesa_ref END
   WHERE id = p_sale_id;
  RETURN 'completed';
END $$;
REVOKE ALL ON FUNCTION public.settle_exchange_balance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_exchange_balance(uuid, text) TO authenticated;

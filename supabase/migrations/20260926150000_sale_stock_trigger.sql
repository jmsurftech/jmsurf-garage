-- Stock follows sales automatically (2026-09-26)
--
-- Every sale that becomes completed reduces stock exactly once, inside the
-- database, whatever the payment method or till: cash, card, split, M-Pesa
-- (PayHero, JMSURF, Daraja, Paystack), open bills, backdated sales and offline
-- sales when they sync. Browsers no longer write stock figures for sales, so
-- two tills selling at once can no longer overwrite each other.
--
-- Credit notes (returns) are not sales and are left to the returns screen.

BEGIN;

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS stock_applied_at timestamptz;
-- Set by current tills on every sale they save. Older tills that are still
-- open (not reloaded yet) reduce stock themselves and leave this false, so
-- their sales are never reduced twice.
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS stock_by_server boolean NOT NULL DEFAULT false;

-- History is already reflected in stock: mark it so nothing is re-deducted.
UPDATE public.transactions SET stock_applied_at = coalesce(created_at, now())
  WHERE status = 'completed' AND stock_applied_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sale_stock_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid,
  tenant_id uuid,
  product_id uuid,
  item jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sale_stock_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_stock_errors_select ON public.sale_stock_errors;
CREATE POLICY sale_stock_errors_select ON public.sale_stock_errors FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));

-- Deducts one sale's lines. A bad line is logged and skipped so a sale is
-- never blocked by a stock problem.
CREATE OR REPLACE FUNCTION public.apply_sale_stock(t public.transactions)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  line_item jsonb;
  product_uuid uuid;
  variant_uuid uuid;
  qty numeric;
  per_unit numeric;
  before_stock numeric;
  after_stock numeric;
BEGIN
  IF t.location_id IS NULL OR t.items IS NULL OR jsonb_typeof(t.items::jsonb) <> 'array' THEN
    RETURN;
  END IF;

  FOR line_item IN SELECT value FROM jsonb_array_elements(t.items::jsonb) LOOP
    product_uuid := NULL;
    BEGIN
      IF coalesce(line_item->>'is_service', 'false') = 'true' THEN CONTINUE; END IF;
      product_uuid := nullif(coalesce(line_item->>'product_id', line_item->>'id'), '')::uuid;
      variant_uuid := nullif(line_item->>'variant_id', '')::uuid;
      qty := coalesce(nullif(line_item->>'quantity', '')::numeric, 0);
      per_unit := coalesce(nullif(line_item->>'stock_per_unit', '')::numeric, 1);
      IF product_uuid IS NULL OR qty <= 0 THEN CONTINUE; END IF;

      -- Only products of this shop.
      PERFORM 1 FROM public.products WHERE id = product_uuid AND tenant_id = t.tenant_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Product not found in shop'; END IF;

      IF variant_uuid IS NOT NULL THEN
        SELECT stock INTO before_stock FROM public.product_variants
          WHERE id = variant_uuid AND product_id = product_uuid FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Missing stock variant %', variant_uuid; END IF;
        after_stock := greatest(0, before_stock - qty);
        UPDATE public.product_variants SET stock = after_stock WHERE id = variant_uuid;
        INSERT INTO public.stock_adjustments
          (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
        VALUES (product_uuid, variant_uuid, t.location_id, -qty, before_stock, after_stock, 'sale', t.cashier_id);
      ELSE
        -- Older catalogues can have products.stock without a branch row: seed it once.
        INSERT INTO public.product_stocks (product_id, location_id, stock)
          SELECT product_uuid, t.location_id,
            CASE WHEN EXISTS (SELECT 1 FROM public.product_stocks WHERE product_id = product_uuid)
              THEN 0 ELSE greatest(0, coalesce(pr.stock, 0)) END
          FROM public.products pr WHERE pr.id = product_uuid
          ON CONFLICT (product_id, location_id) DO NOTHING;
        SELECT stock INTO before_stock FROM public.product_stocks
          WHERE product_id = product_uuid AND location_id = t.location_id FOR UPDATE;
        after_stock := greatest(0, round(before_stock - qty * per_unit, 3));
        UPDATE public.product_stocks SET stock = after_stock
          WHERE product_id = product_uuid AND location_id = t.location_id;
        INSERT INTO public.stock_adjustments
          (product_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
        VALUES (product_uuid, t.location_id, -(qty * per_unit), before_stock, after_stock, 'sale', t.cashier_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.sale_stock_errors (transaction_id, tenant_id, product_id, item, error)
        VALUES (t.id, t.tenant_id, product_uuid, line_item, left(SQLERRM, 500));
    END;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.apply_sale_stock(public.transactions) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_sale_stock_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'completed'
     AND NEW.stock_applied_at IS NULL
     AND coalesce(NEW.payment_method, '') <> 'credit_note'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
     -- Current tills mark their sales; M-Pesa sales confirmed by the payment
     -- server are always reduced here (the settlement no longer does it).
     AND (NEW.stock_by_server
          OR (TG_OP = 'UPDATE' AND coalesce(OLD.mpesa_ref, '') ~ '^(payhero|jmsurf|daraja):')) THEN
    PERFORM public.apply_sale_stock(NEW);
    NEW.stock_applied_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.apply_sale_stock_on_complete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS apply_sale_stock ON public.transactions;
CREATE TRIGGER apply_sale_stock
  BEFORE INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_sale_stock_on_complete();

-- The payment settlement functions used to deduct stock themselves. Stock is
-- now handled by the trigger above when they mark the sale completed, so the
-- settlement only records the payment outcome.
CREATE OR REPLACE FUNCTION public.settle_payhero_payment(p_pos_transaction_id uuid, p_status text, p_receipt text DEFAULT NULL::text, p_provider_status jsonb DEFAULT NULL::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  p public.payhero_transactions%ROWTYPE;
  t public.transactions%ROWTYPE;
BEGIN
  IF p_status NOT IN ('pending','completed','failed','cancelled') THEN
    RAISE EXCEPTION 'Invalid payment outcome';
  END IF;
  SELECT * INTO p FROM public.payhero_transactions
    WHERE pos_transaction_id = p_pos_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PayHero payment not found'; END IF;
  SELECT * INTO t FROM public.transactions
    WHERE id = p_pos_transaction_id AND tenant_id = p.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found for payment'; END IF;
  IF p.amount IS DISTINCT FROM t.total THEN RAISE EXCEPTION 'Payment amount does not match sale'; END IF;
  IF p.status = 'completed' THEN RETURN 'completed'; END IF;
  IF t.status = 'completed' THEN
    RAISE EXCEPTION 'Sale was completed outside the PayHero payment';
  END IF;
  IF p.status IN ('failed','cancelled') AND p_status <> 'completed' THEN RETURN p.status; END IF;

  IF p_status = 'completed' THEN
    IF coalesce(trim(p_receipt),'') = '' THEN
      RAISE EXCEPTION 'Confirmed payment requires an M-Pesa receipt';
    END IF;
    UPDATE public.transactions SET status = 'completed', mpesa_ref = p_receipt,
      mpesa_error_message = NULL, mpesa_error_payload = NULL
      WHERE id = t.id;
  ELSIF p_status IN ('failed','cancelled') THEN
    UPDATE public.transactions SET status = p_status,
      mpesa_error_message = left(coalesce(p_provider_status->>'message', p_provider_status->>'status', p_status), 500),
      mpesa_error_payload = p_provider_status
      WHERE id = t.id AND status = 'pending';
  END IF;
  UPDATE public.payhero_transactions SET status = p_status,
    mpesa_receipt = CASE WHEN p_status = 'completed' THEN p_receipt ELSE mpesa_receipt END,
    result_desc = left(coalesce(p_provider_status->>'status', p_status), 500),
    raw_callback = p_provider_status,
    updated_at = now()
    WHERE id = p.id;
  RETURN p_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_sendmoney_payment(p_pos_transaction_id uuid, p_status text, p_receipt text DEFAULT NULL::text, p_provider_status jsonb DEFAULT NULL::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  p public.sendmoney_payments%ROWTYPE;
  t public.transactions%ROWTYPE;
BEGIN
  IF p_status NOT IN ('pending','completed','failed','cancelled') THEN
    RAISE EXCEPTION 'Invalid payment outcome';
  END IF;
  SELECT * INTO p FROM public.sendmoney_payments
    WHERE pos_transaction_id = p_pos_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SendMoney payment not found'; END IF;
  SELECT * INTO t FROM public.transactions
    WHERE id = p_pos_transaction_id AND tenant_id = p.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found for payment'; END IF;
  IF p.status = 'completed' THEN RETURN 'completed'; END IF;
  IF t.status = 'completed' THEN
    RAISE EXCEPTION 'Sale was completed outside the JMSURF payment';
  END IF;
  IF p.status IN ('failed','cancelled') AND p_status <> 'completed' THEN RETURN p.status; END IF;

  IF p_status = 'completed' THEN
    IF coalesce(trim(p_receipt),'') = '' THEN
      RAISE EXCEPTION 'Confirmed payment requires an M-Pesa receipt';
    END IF;
    UPDATE public.transactions SET status = 'completed', mpesa_ref = p_receipt,
      mpesa_error_message = NULL, mpesa_error_payload = NULL
      WHERE id = t.id;
  ELSIF p_status IN ('failed','cancelled') THEN
    UPDATE public.transactions SET status = p_status,
      mpesa_error_message = left(coalesce(p_provider_status->>'message', p_provider_status->>'resultDesc', p_status), 500),
      mpesa_error_payload = p_provider_status
      WHERE id = t.id AND status = 'pending';
  END IF;
  UPDATE public.sendmoney_payments SET status = p_status,
    mpesa_receipt = CASE WHEN p_status = 'completed' THEN p_receipt ELSE mpesa_receipt END,
    provider_status = p_provider_status, checked_at = now(),
    settled_at = CASE WHEN p_status = 'completed' THEN now() ELSE settled_at END
    WHERE id = p.id;
  RETURN p_status;
END;
$function$;

COMMIT;

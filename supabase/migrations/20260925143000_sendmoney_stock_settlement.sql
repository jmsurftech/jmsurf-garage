-- SendMoney identifiers are server-owned. Never expose the platform API key or
-- let a tenant assign its own settlement destination through PostgREST.
CREATE TABLE IF NOT EXISTS public.sendmoney_tenants (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_code text NOT NULL UNIQUE,
  provider_tenant_id text NOT NULL,
  settlement_account_id text NOT NULL,
  destination_type text NOT NULL CHECK (destination_type IN ('till', 'paybill', 'bank')),
  business_number text,
  account_number text NOT NULL,
  account_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sendmoney_tenants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sendmoney_tenants FROM anon, authenticated;
GRANT ALL ON public.sendmoney_tenants TO service_role;

-- Reservation prevents two administrators provisioning two remote settlement
-- accounts for the same POS tenant at the same time. Ambiguous failures stay
-- reserved for support reconciliation instead of creating a duplicate.
CREATE TABLE IF NOT EXISTS public.sendmoney_provisioning (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  destination_type text NOT NULL,
  business_number text,
  account_number text NOT NULL,
  account_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sendmoney_provisioning ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sendmoney_provisioning FROM anon, authenticated;
GRANT ALL ON public.sendmoney_provisioning TO service_role;

CREATE TABLE IF NOT EXISTS public.sendmoney_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  pos_transaction_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id),
  checkout_request_id text UNIQUE,
  phone text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'initiating' CHECK (status IN ('initiating','pending','completed','failed','cancelled')),
  mpesa_receipt text,
  provider_status jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  settled_at timestamptz
);
ALTER TABLE public.sendmoney_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sendmoney_payments FROM anon, authenticated;
GRANT ALL ON public.sendmoney_payments TO service_role;
CREATE INDEX IF NOT EXISTS sendmoney_payments_pending_idx
  ON public.sendmoney_payments (started_at) WHERE status IN ('initiating','pending');

-- Inventory defects must not hide a confirmed payment. Keep a durable record
-- for reconciliation while the sale and receipt still complete exactly once.
CREATE TABLE IF NOT EXISTS public.sendmoney_stock_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.sendmoney_payments(id),
  product_id uuid,
  item jsonb NOT NULL,
  error text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sendmoney_stock_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sendmoney_stock_errors FROM anon, authenticated;
GRANT ALL ON public.sendmoney_stock_errors TO service_role;

-- A provider-confirmed payment is applied once, under a row lock. Concurrent
-- status checks cannot deduct inventory twice. The server calls this only with
-- its service-role key after checking SendMoney's authenticated status API.
CREATE OR REPLACE FUNCTION public.settle_sendmoney_payment(
  p_pos_transaction_id uuid,
  p_status text,
  p_receipt text DEFAULT NULL,
  p_provider_status jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  p public.sendmoney_payments%ROWTYPE;
  t public.transactions%ROWTYPE;
  line_item jsonb;
  product_uuid uuid;
  variant_uuid uuid;
  quantity numeric;
  per_unit numeric;
  before_stock numeric;
  after_stock numeric;
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
    IF t.location_id IS NOT NULL AND jsonb_typeof(t.items::jsonb) = 'array' THEN
      FOR line_item IN SELECT value FROM jsonb_array_elements(t.items::jsonb) LOOP
        product_uuid := NULL;
        BEGIN
        IF coalesce(line_item->>'is_service','false') = 'true' THEN CONTINUE; END IF;
        product_uuid := nullif(coalesce(line_item->>'product_id', line_item->>'id'),'')::uuid;
        variant_uuid := nullif(line_item->>'variant_id','')::uuid;
        quantity := coalesce(nullif(line_item->>'quantity','')::numeric,0);
        per_unit := coalesce(nullif(line_item->>'stock_per_unit','')::numeric,1);
        IF product_uuid IS NULL OR quantity <= 0 THEN CONTINUE; END IF;
        IF variant_uuid IS NOT NULL THEN
          SELECT stock INTO before_stock FROM public.product_variants
            WHERE id = variant_uuid AND product_id = product_uuid FOR UPDATE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Missing stock variant %', variant_uuid;
          END IF;
          after_stock := greatest(0, before_stock - quantity);
          UPDATE public.product_variants SET stock = greatest(0, stock - quantity)
            WHERE id = variant_uuid AND product_id = product_uuid;
          INSERT INTO public.stock_adjustments
            (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason)
          VALUES (product_uuid, variant_uuid, t.location_id, -quantity, before_stock, after_stock, 'sale');
        ELSE
          -- Older catalogues can have products.stock without any branch row.
          -- Lock the product before seeding its first branch row so concurrent
          -- paid sales cannot both copy the same starting balance.
          PERFORM 1 FROM public.products
            WHERE id = product_uuid AND tenant_id = t.tenant_id FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Product not found in shop'; END IF;
          INSERT INTO public.product_stocks (product_id, location_id, stock)
            SELECT product_uuid, t.location_id,
              CASE WHEN EXISTS (
                SELECT 1 FROM public.product_stocks WHERE product_id = product_uuid
              ) THEN 0 ELSE greatest(0, coalesce(pr.stock, 0)) END
            FROM public.products pr WHERE pr.id = product_uuid
            ON CONFLICT (product_id, location_id) DO NOTHING;
          SELECT stock INTO before_stock FROM public.product_stocks
            WHERE product_id = product_uuid AND location_id = t.location_id FOR UPDATE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Missing stock row for product %', product_uuid;
          END IF;
          after_stock := greatest(0, before_stock - quantity * per_unit);
          UPDATE public.product_stocks SET stock = after_stock
            WHERE product_id = product_uuid AND location_id = t.location_id;
          UPDATE public.products SET stock = (
            SELECT sum(stock) FROM public.product_stocks WHERE product_id = product_uuid
          ) WHERE id = product_uuid;
          INSERT INTO public.stock_adjustments
            (product_id, location_id, quantity_change, stock_before, stock_after, reason)
          VALUES (product_uuid, t.location_id, -(quantity * per_unit), before_stock, after_stock, 'sale');
        END IF;
        EXCEPTION WHEN OTHERS THEN
          INSERT INTO public.sendmoney_stock_errors (payment_id, product_id, item, error)
            VALUES (p.id, product_uuid, line_item, left(SQLERRM, 500));
        END;
      END LOOP;
    END IF;
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
$$;
REVOKE ALL ON FUNCTION public.settle_sendmoney_payment(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_sendmoney_payment(uuid,text,text,jsonb) TO service_role;

-- A late browser cancel must never turn a confirmed paid sale back into a
-- cancelled sale. Pending JMSURF payments are decided by the provider.
CREATE OR REPLACE FUNCTION public.guard_sendmoney_sale_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'completed' AND NEW.status <> 'completed'
     AND EXISTS (SELECT 1 FROM public.sendmoney_payments
       WHERE pos_transaction_id = OLD.id AND status = 'completed') THEN
    RAISE EXCEPTION 'Confirmed JMSURF payment cannot be cancelled';
  END IF;
  IF NEW.status IN ('cancelled','failed')
     AND current_setting('request.jwt.claim.role', true) IN ('anon','authenticated')
     AND EXISTS (SELECT 1 FROM public.sendmoney_payments
       WHERE pos_transaction_id = OLD.id AND status IN ('initiating','pending')) THEN
    RAISE EXCEPTION 'JMSURF payment is still being confirmed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_sendmoney_sale_status ON public.transactions;
CREATE TRIGGER guard_sendmoney_sale_status
  BEFORE UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_sendmoney_sale_status();
NOTIFY pgrst, 'reload schema';

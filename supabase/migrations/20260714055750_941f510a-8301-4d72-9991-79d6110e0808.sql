
ALTER EVENT TRIGGER ensure_rls_helper_grants_trg DISABLE;

CREATE TABLE IF NOT EXISTS public.aggregator_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregator_tenant_id uuid NOT NULL REFERENCES public.aggregator_tenants(id) ON DELETE CASCADE,
  source_transaction_id uuid REFERENCES public.aggregator_transactions(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  destination_type text NOT NULL CHECK (destination_type IN ('till','paybill','bank')),
  destination_ref text NOT NULL,
  destination_account text,
  channel text NOT NULL CHECK (channel IN ('daraja_b2c','daraja_b2b','payhero_pesalink')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','reversed')),
  provider_ref text,
  conversation_id text,
  originator_conversation_id text,
  mpesa_receipt text,
  result_code integer,
  result_desc text,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  raw_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agg_payouts_tenant ON public.aggregator_payouts(aggregator_tenant_id);
CREATE INDEX IF NOT EXISTS idx_agg_payouts_status ON public.aggregator_payouts(status);
CREATE INDEX IF NOT EXISTS idx_agg_payouts_source ON public.aggregator_payouts(source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_agg_payouts_conv ON public.aggregator_payouts(conversation_id);
GRANT SELECT ON public.aggregator_payouts TO authenticated;
GRANT ALL ON public.aggregator_payouts TO service_role;
ALTER TABLE public.aggregator_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agg_payouts_admin_all" ON public.aggregator_payouts
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "agg_payouts_tenant_select" ON public.aggregator_payouts
  FOR SELECT TO authenticated
  USING (aggregator_tenant_id IN (SELECT id FROM public.aggregator_tenants WHERE user_id = auth.uid()));
CREATE TRIGGER trg_agg_payouts_updated
  BEFORE UPDATE ON public.aggregator_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.aggregator_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregator_tenant_id uuid NOT NULL REFERENCES public.aggregator_tenants(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('credit_collection','debit_payout','debit_reversal','debit_fee','credit_adjustment','debit_adjustment')),
  amount numeric NOT NULL CHECK (amount > 0),
  ref_transaction_id uuid REFERENCES public.aggregator_transactions(id) ON DELETE SET NULL,
  ref_payout_id uuid REFERENCES public.aggregator_payouts(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agg_ledger_tenant ON public.aggregator_ledger(aggregator_tenant_id, created_at DESC);
GRANT SELECT ON public.aggregator_ledger TO authenticated;
GRANT ALL ON public.aggregator_ledger TO service_role;
ALTER TABLE public.aggregator_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agg_ledger_admin_all" ON public.aggregator_ledger
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "agg_ledger_tenant_select" ON public.aggregator_ledger
  FOR SELECT TO authenticated
  USING (aggregator_tenant_id IN (SELECT id FROM public.aggregator_tenants WHERE user_id = auth.uid()));

CREATE OR REPLACE VIEW public.aggregator_tenant_balances
WITH (security_invoker = true) AS
SELECT
  t.id AS aggregator_tenant_id, t.name, t.slug,
  COALESCE(SUM(CASE WHEN l.entry_type IN ('credit_collection','credit_adjustment') THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.entry_type IN ('debit_payout','debit_reversal','debit_fee','debit_adjustment') THEN l.amount ELSE 0 END), 0) AS balance,
  COALESCE(SUM(CASE WHEN l.entry_type = 'credit_collection' THEN l.amount ELSE 0 END), 0) AS lifetime_collected,
  COALESCE(SUM(CASE WHEN l.entry_type = 'debit_payout' THEN l.amount ELSE 0 END), 0) AS lifetime_paid_out,
  COALESCE((SELECT SUM(amount) FROM public.aggregator_payouts p
            WHERE p.aggregator_tenant_id = t.id AND p.status IN ('pending','processing')), 0) AS pending_payouts
FROM public.aggregator_tenants t
LEFT JOIN public.aggregator_ledger l ON l.aggregator_tenant_id = t.id
GROUP BY t.id, t.name, t.slug;
GRANT SELECT ON public.aggregator_tenant_balances TO authenticated;

ALTER TABLE public.aggregator_settings ALTER COLUMN commission_percent SET DEFAULT 0;
UPDATE public.aggregator_settings SET commission_percent = 0 WHERE commission_percent > 0;

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.aggregator_payouts; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
ALTER TABLE public.aggregator_payouts REPLICA IDENTITY FULL;

ALTER EVENT TRIGGER ensure_rls_helper_grants_trg ENABLE;

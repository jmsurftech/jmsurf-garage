ALTER EVENT TRIGGER ensure_rls_helper_grants_trg DISABLE;

CREATE TABLE public.aggregator_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregator_tenant_id uuid NOT NULL REFERENCES public.aggregator_tenants(id) ON DELETE CASCADE,
  pos_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  aggregator_transaction_id uuid REFERENCES public.aggregator_transactions(id) ON DELETE SET NULL,
  payout_id uuid REFERENCES public.aggregator_payouts(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.aggregator_audit_events TO authenticated;
GRANT ALL ON public.aggregator_audit_events TO service_role;

ALTER TABLE public.aggregator_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view all aggregator audit events"
ON public.aggregator_audit_events
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Merchants can view their own aggregator audit events"
ON public.aggregator_audit_events
FOR SELECT
TO authenticated
USING (
  aggregator_tenant_id IN (
    SELECT id FROM public.aggregator_tenants WHERE user_id = auth.uid()
  )
);

CREATE INDEX idx_aggregator_audit_events_tenant_created
ON public.aggregator_audit_events (aggregator_tenant_id, created_at DESC);

CREATE INDEX idx_aggregator_audit_events_pos_transaction
ON public.aggregator_audit_events (pos_transaction_id, created_at DESC)
WHERE pos_transaction_id IS NOT NULL;

CREATE INDEX idx_aggregator_audit_events_payout
ON public.aggregator_audit_events (payout_id, created_at DESC)
WHERE payout_id IS NOT NULL;

ALTER EVENT TRIGGER ensure_rls_helper_grants_trg ENABLE;
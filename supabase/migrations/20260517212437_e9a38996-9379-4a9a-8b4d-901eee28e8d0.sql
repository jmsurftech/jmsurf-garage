-- Helper: only create index if the table+column exist
DO $$
DECLARE
  r record;
  tables_with_tenant text[] := ARRAY[
    'transactions','products','customers','invoices','quotes','expenses',
    'bills','payments','stock_movements','delivery_notes','packing_lists',
    'suppliers','user_activity_log','email_send_log','purchase_orders',
    'business_settings','locations','services','user_roles'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables_with_tenant LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_tenant_id ON public.%I (tenant_id)', t, t);
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='created_at') THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_tenant_created ON public.%I (tenant_id, created_at DESC)', t, t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Tenant slug lookup (login/routing hot path)
CREATE INDEX IF NOT EXISTS idx_tenants_slug_lower ON public.tenants (lower(slug));

-- Profile by user (called on every page mount)
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON public.profiles (tenant_id);

-- User roles (auth hot path)
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id);

-- Transactions: payment status filter (POS, M-Pesa polling)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='status') THEN
    CREATE INDEX IF NOT EXISTS idx_transactions_tenant_status ON public.transactions (tenant_id, status);
  END IF;
END $$;

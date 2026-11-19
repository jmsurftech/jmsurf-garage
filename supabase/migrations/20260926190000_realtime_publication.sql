-- Live updates for shop screens (2026-09-26)
--
-- Only plans/subscriptions/feature overrides were broadcast, so a sale, a new
-- product or a stock change never reached other screens until a manual
-- refresh. Row-level security still applies to every subscriber, so each
-- shop only ever receives its own rows.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transactions','products','product_stocks','product_variants','customers',
    'expenses','bills','bill_payments','open_bills','empties_ledger','services',
    'purchases','shifts','cash_register','layaways','quotes','invoices',
    'suppliers','locations','business_settings','delivery_notes','packing_lists',
    'variant_exchanges','stock_adjustments','product_categories','product_batches'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

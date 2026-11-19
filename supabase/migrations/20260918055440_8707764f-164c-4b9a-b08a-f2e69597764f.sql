ALTER TABLE public.subscriptions REPLICA IDENTITY FULL;
ALTER TABLE public.tenant_feature_overrides REPLICA IDENTITY FULL;
ALTER TABLE public.plans REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='subscriptions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tenant_feature_overrides') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_feature_overrides;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='plans') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.plans;
  END IF;
END $$;
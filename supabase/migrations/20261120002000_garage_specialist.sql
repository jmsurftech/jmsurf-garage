-- JMSURF Garage specialist modules (insurance, fleet contracts, imports, vehicle yard,
-- body & paint, car wash, tyres, towing, car hire).
--
-- The modules keep their records in the record engine (public.app_records, app = module
-- key) under its existing tenant RLS, bill through public.invoices and reuse
-- public.landed_costs / apply_landed_cost for parts imported into stock. No new tables.
--
-- This migration only adds partial indexes for the no-login links, which the server
-- (garage-specialist.js) looks up by a random token kept in app_records.data:
--   fleet portal       app fleet_contracts, kind fleet          data->>'portal_token'
--   driver daily check app fleet_contracts, kind fleet_vehicle  data->>'check_token'
--   pre-order status   app imports,         kind preorder       data->>'token'
-- and one for the public car listings page (stock cars per company by stage).
-- Safe to run more than once.

create index if not exists app_records_garage_fleet_token_idx
  on public.app_records ((data->>'portal_token'))
  where app = 'fleet_contracts' and kind = 'fleet';

create index if not exists app_records_garage_check_token_idx
  on public.app_records ((data->>'check_token'))
  where app = 'fleet_contracts' and kind = 'fleet_vehicle';

create index if not exists app_records_garage_preorder_token_idx
  on public.app_records ((data->>'token'))
  where app = 'imports' and kind = 'preorder';

create index if not exists app_records_garage_yard_idx
  on public.app_records (tenant_id, stage, created_at desc)
  where app = 'vehicle_yard' and kind = 'car' and not archived;

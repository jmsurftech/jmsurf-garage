-- Purchases reported to KRA eTIMS (bills), and bills created from purchases KRA holds.
alter table public.bills add column if not exists etims_status text;
alter table public.bills add column if not exists etims_error text;
alter table public.bills add column if not exists etims_reported_at timestamptz;
alter table public.bills add column if not exists etims_purchase_id uuid;

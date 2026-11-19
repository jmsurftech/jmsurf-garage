-- Inventory adjustments reported to KRA eTIMS as stock movements.
alter table public.inventory_adjustments add column if not exists etims_status text;
alter table public.inventory_adjustments add column if not exists etims_error text;

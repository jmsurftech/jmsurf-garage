-- Items as in Zoho: Sales Information and Purchase Information can each be switched off
-- (an item only bought, or only sold), and the purchase side has its own description.
alter table public.products add column if not exists sales_enabled boolean not null default true;
alter table public.products add column if not exists purchase_enabled boolean not null default true;
alter table public.products add column if not exists purchase_description text;
alter table public.services add column if not exists sales_enabled boolean not null default true;
alter table public.services add column if not exists purchase_enabled boolean not null default true;
alter table public.services add column if not exists purchase_description text;

-- KRA eTIMS: products, services and customers are sent to KRA (through JMSURF TAX) when they are saved.
-- Each keeps what KRA answered: the KRA code / customer number, or the reason it was not accepted.

alter table public.customers add column if not exists etims_cust_no text;
alter table public.customers add column if not exists etims_registered_at timestamptz;
alter table public.customers add column if not exists etims_error text;

alter table public.products add column if not exists etims_registered_at timestamptz;
alter table public.products add column if not exists etims_error text;

alter table public.services add column if not exists etims_item_cd text;
alter table public.services add column if not exists etims_registered_at timestamptz;
alter table public.services add column if not exists etims_error text;

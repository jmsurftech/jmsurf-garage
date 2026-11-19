-- Purchase orders as in Zoho: payment terms, shipment preference, and delivery to a branch or straight to a customer.
alter table public.purchases add column if not exists payment_terms text;
alter table public.purchases add column if not exists shipment_preference text;
alter table public.purchases add column if not exists deliver_to text not null default 'location';
alter table public.purchases drop constraint if exists purchases_deliver_to_check;
alter table public.purchases add constraint purchases_deliver_to_check check (deliver_to in ('location', 'customer'));
alter table public.purchases add column if not exists delivery_customer_id uuid references public.customers(id) on delete set null;
alter table public.purchases add column if not exists delivery_address text;

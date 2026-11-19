-- Sales documents as in Zoho: sales orders carry payment terms and a delivery method; invoices say whether the customer
-- may pay online (M-Pesa); payments received record bank charges and the account the money went to.
alter table public.sales_orders add column if not exists payment_terms text;
alter table public.sales_orders add column if not exists delivery_method text;
alter table public.invoices add column if not exists allow_online_payment boolean not null default true;
alter table public.payments_received add column if not exists bank_charges numeric not null default 0;
alter table public.payments_received add column if not exists deposit_to text;
notify pgrst, 'reload schema';

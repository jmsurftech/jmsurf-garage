-- Prices that include VAT (Zoho's "Tax Inclusive"): the line amounts are gross, VAT is taken out of them,
-- and the total is what the customer pays. Posting already uses total − VAT as sales.
alter table public.quotes add column if not exists prices_include_tax boolean not null default false;
alter table public.sales_orders add column if not exists prices_include_tax boolean not null default false;
alter table public.invoices add column if not exists prices_include_tax boolean not null default false;
alter table public.credit_notes add column if not exists prices_include_tax boolean not null default false;
alter table public.purchases add column if not exists prices_include_tax boolean not null default false;
alter table public.bills add column if not exists prices_include_tax boolean not null default false;
-- Invoices moved in from Zoho were VAT-inclusive when their total equals the line amounts.
update public.invoices set prices_include_tax = true
 where source = 'import' and coalesce(tax, 0) > 0 and abs(coalesce(total, 0) - coalesce(subtotal, 0)) < 0.05;

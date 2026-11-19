-- Bills as in Zoho: an order number and a description (subject) besides the vendor's bill number (reference).
alter table public.bills add column if not exists order_number text;
alter table public.bills add column if not exists subject text;

-- Bills link to their purchase order (the bill page shows "PO#"; without the link the bill document did not open).
alter table public.bills drop constraint if exists bills_purchase_id_fkey;
alter table public.bills add constraint bills_purchase_id_fkey foreign key (purchase_id) references public.purchases(id) on delete set null;
notify pgrst, 'reload schema';

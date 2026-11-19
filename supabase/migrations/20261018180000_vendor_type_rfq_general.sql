-- Vendors can be a company or an individual (customers already have customer_type business / individual).
alter table public.suppliers add column if not exists supplier_type text not null default 'company';
alter table public.suppliers drop constraint if exists suppliers_supplier_type_check;
alter table public.suppliers add constraint suppliers_supplier_type_check check (supplier_type in ('company', 'individual'));

-- RFQs are created general (no supplier) and sent later to the suppliers picked, by email, SMS or WhatsApp.
alter table public.rfqs add column if not exists sent_log jsonb not null default '[]'::jsonb;
alter table public.rfqs alter column supplier_ids set default '{}';

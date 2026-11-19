-- "Sales Orders": confirmed orders between a quote and the invoice.
create table if not exists public.sales_orders (like public.quotes including defaults including constraints including indexes);
alter table public.sales_orders add column if not exists expected_shipment_date date;
alter table public.sales_orders add column if not exists quote_id uuid;
alter table public.sales_orders alter column tenant_id set default public.current_user_tenant_id();
alter table public.sales_orders enable row level security;
drop policy if exists sales_orders_select on public.sales_orders;
create policy sales_orders_select on public.sales_orders for select to authenticated
  using (tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists sales_orders_manage on public.sales_orders;
create policy sales_orders_manage on public.sales_orders for all to authenticated
  using ((tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'cashier') or public.has_role(auth.uid(), 'sales_person'))) or public.has_role(auth.uid(), 'super_admin'))
  with check ((tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'cashier') or public.has_role(auth.uid(), 'sales_person'))) or public.has_role(auth.uid(), 'super_admin'));
grant select, insert, update, delete on public.sales_orders to authenticated;
create index if not exists sales_orders_tenant_idx on public.sales_orders (tenant_id, created_at desc);

create or replace function public.doc_prefix_default(p_kind text)
returns text language sql immutable as $$
  select case p_kind
    when 'quote' then 'QT-' when 'invoice' then 'INV-' when 'payment' then 'PR-' when 'receipt' then 'SR-'
    when 'credit_note' then 'CN-' when 'po' then 'PO-' when 'bill' then 'BILL-' when 'requisition' then 'REQ-'
    when 'delivery_note' then 'DN-' when 'packing_list' then 'PL-' when 'lead' then 'LD-' when 'web_order' then 'WEB-' when 'employee' then 'EMP-'
    when 'payroll' then 'PAY-' when 'purchase_receive' then 'GRN-' when 'expense' then 'EXP-' when 'supplier_payment' then 'SP-'
    when 'adjustment' then 'ADJ-' when 'deal' then 'DEAL-' when 'vendor_credit' then 'VC-' when 'sales_order' then 'SO-' when 'journal' then 'MJ-'
    else upper(left(p_kind, 3)) || '-' end
$$;

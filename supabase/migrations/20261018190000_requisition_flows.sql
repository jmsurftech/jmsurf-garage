-- Requisitions for every kind of company spending:
--   expense  – rent, airtime, fuel allowance, utilities… approved → recorded in Expenses
--   purchase – things the company uses (computers, furniture) → PO (vendor known) or RFQ (no vendor yet)
--   restock  – stock items → PO (vendor known) or RFQ, then the RFQ is converted to a PO with the chosen vendor
alter table public.requisitions add column if not exists kind text not null default 'purchase';
alter table public.requisitions drop constraint if exists requisitions_kind_check;
alter table public.requisitions add constraint requisitions_kind_check check (kind in ('expense', 'purchase', 'restock'));
alter table public.requisitions add column if not exists expense_category_id uuid references public.expense_categories(id) on delete set null;
alter table public.requisitions add column if not exists expense_id uuid references public.expenses(id) on delete set null;
alter table public.requisitions add column if not exists rfq_id uuid references public.rfqs(id) on delete set null;

-- A line with no item (a laptop, a chair) gets a company-use item, kept out of the till and shop.
create or replace function public._req_line_product(p_tenant uuid, p_name text, p_unit text, p_cost numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select id into pid from public.products where tenant_id = p_tenant and lower(name) = lower(trim(p_name)) limit 1;
  if pid is not null then return pid; end if;
  insert into public.products (tenant_id, name, sku, unit, cost_price, price, category, is_active, product_type)
  values (p_tenant, trim(p_name), 'CU-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)), coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'piece'),
          coalesce(p_cost, 0), 0, 'Company use', false, 'product')
  returning id into pid;
  return pid;
end $$;

-- Requisition → purchase order (vendor known). Lines without an item get a company-use item.
create or replace function public.requisition_to_po(p_req uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.requisitions; po uuid; tot numeric; l record;
begin
  select * into r from public.requisitions where id = p_req and tenant_id = public.current_user_tenant_id();
  if not found then raise exception 'Requisition not found'; end if;
  if r.purchase_id is not null then return r.purchase_id; end if;
  if r.kind = 'expense' then raise exception 'This is an expense requisition: record it as an expense'; end if;
  if r.status not in ('approved', 'sent', 'acknowledged') then raise exception 'Approve the requisition first'; end if;
  if coalesce(r.supplier_name, '') = '' then raise exception 'Choose the vendor first, or send it as a request for quotation'; end if;
  for l in select * from public.requisition_items where requisition_id = p_req and product_id is null and coalesce(qty_approved, qty_requested) > 0 loop
    update public.requisition_items set product_id = public._req_line_product(r.tenant_id, l.name, l.unit, l.est_unit_cost) where id = l.id;
  end loop;
  select coalesce(sum(coalesce(qty_approved, qty_requested) * est_unit_cost), 0) into tot from public.requisition_items where requisition_id = p_req;
  insert into public.purchases (tenant_id, po_number, order_date, expected_date, supplier_id, supplier_name, location_id, status, subtotal, tax, total, notes, reference, created_by, payment_status, amount_paid)
  values (r.tenant_id, public.next_doc_number('po', r.tenant_id), current_date, r.needed_by, r.supplier_id, r.supplier_name,
          coalesce(r.location_id, (select id from public.locations where tenant_id = r.tenant_id and is_main limit 1)),
          'draft', tot, 0, tot, 'From requisition ' || coalesce(r.number, ''), r.number, auth.uid(), 'unpaid', 0)
  returning id into po;
  insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, total, received_quantity)
  select po, product_id, ceil(coalesce(qty_approved, qty_requested))::int, est_unit_cost, ceil(coalesce(qty_approved, qty_requested)) * est_unit_cost, 0
    from public.requisition_items where requisition_id = p_req and coalesce(qty_approved, qty_requested) > 0;
  update public.requisitions set status = 'ordered', purchase_id = po, updated_at = now() where id = p_req;
  perform public._req_log(p_req, 'ordered', 'Purchase order created');
  return po;
end $$;

-- Requisition → request for quotation (no vendor yet). The RFQ is general: it is sent to the vendors chosen later.
create or replace function public.requisition_to_rfq(p_req uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.requisitions; q uuid;
begin
  select * into r from public.requisitions where id = p_req and tenant_id = public.current_user_tenant_id();
  if not found then raise exception 'Requisition not found'; end if;
  if r.rfq_id is not null then return r.rfq_id; end if;
  if r.kind = 'expense' then raise exception 'This is an expense requisition: record it as an expense'; end if;
  if r.status not in ('approved', 'sent', 'acknowledged') then raise exception 'Approve the requisition first'; end if;
  insert into public.rfqs (tenant_id, number, title, requisition_id, location_id, status, lines, needed_by, supplier_ids, notes, created_by)
  select r.tenant_id, public.next_doc_number('rfq', r.tenant_id), 'From requisition ' || coalesce(r.number, ''), r.id, r.location_id, 'draft',
         coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', i.name, 'unit', i.unit, 'quantity', coalesce(i.qty_approved, i.qty_requested), 'est_unit_cost', i.est_unit_cost) order by i.sort), '[]'::jsonb),
         r.needed_by, '{}', r.notes, auth.uid()
    from public.requisition_items i where i.requisition_id = p_req and coalesce(i.qty_approved, i.qty_requested) > 0
  returning id into q;
  update public.requisitions set rfq_id = q, status = 'sent', sent_via = 'rfq', sent_at = now(), updated_at = now() where id = p_req;
  perform public._req_log(p_req, 'rfq', 'Request for quotation created');
  return q;
end $$;

-- Expense requisition → expense (rent, airtime, fuel allowance…), once approved.
create or replace function public.requisition_to_expense(p_req uuid, p_method text default 'cash', p_paid_through text default null, p_date date default current_date, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.requisitions; e uuid; tot numeric; cat record; what text;
begin
  select * into r from public.requisitions where id = p_req and tenant_id = public.current_user_tenant_id();
  if not found then raise exception 'Requisition not found'; end if;
  if r.expense_id is not null then return r.expense_id; end if;
  if r.status not in ('approved', 'sent', 'acknowledged') then raise exception 'Approve the requisition first'; end if;
  select coalesce(sum(coalesce(qty_approved, qty_requested) * est_unit_cost), 0), string_agg(name, ', ' order by sort) into tot, what
    from public.requisition_items where requisition_id = p_req and coalesce(qty_approved, qty_requested) > 0;
  if tot <= 0 then raise exception 'The approved amount is zero'; end if;
  select id, name into cat from public.expense_categories where id = r.expense_category_id;
  insert into public.expenses (tenant_id, category_id, category_name, description, amount, location_id, expense_date, created_by, created_by_name,
                               supplier_id, vendor_name, payment_method, paid_through, reference, notes, approval_status)
  values (r.tenant_id, cat.id, coalesce(cat.name, 'General'), left(what, 200), tot,
          coalesce(r.location_id, (select id from public.locations where tenant_id = r.tenant_id and is_main limit 1)),
          coalesce(p_date, current_date), auth.uid(), public._me_name(), r.supplier_id, r.supplier_name, coalesce(nullif(p_method, ''), 'cash'), p_paid_through,
          coalesce(nullif(p_reference, ''), r.number), 'From requisition ' || coalesce(r.number, '') || coalesce(' (requested by ' || r.requested_by_name || ')', ''), 'approved')
  returning id into e;
  update public.requisitions set expense_id = e, status = 'received', updated_at = now() where id = p_req;
  perform public._req_log(p_req, 'expense', 'Recorded as an expense');
  return e;
end $$;

-- RFQ → purchase order for the vendor chosen, at that vendor's quoted prices (or the estimates when no quote was recorded).
-- Files attached to the RFQ (vendors' quotations) are attached to the purchase order too.
create or replace function public.rfq_to_po(p_rfq uuid, p_supplier uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare q public.rfqs; quote public.rfq_quotes; s record; po uuid; tot numeric := 0; l jsonb; pid uuid; qty numeric; price numeric; i int := 0; ql jsonb;
begin
  select * into q from public.rfqs where id = p_rfq and tenant_id = public.current_user_tenant_id();
  if not found then raise exception 'RFQ not found'; end if;
  if q.purchase_id is not null then return q.purchase_id; end if;
  select id, name into s from public.suppliers where id = p_supplier and tenant_id = q.tenant_id;
  if s.id is null then raise exception 'Choose the vendor'; end if;
  select * into quote from public.rfq_quotes where rfq_id = p_rfq and supplier_id = p_supplier;
  insert into public.purchases (tenant_id, po_number, order_date, expected_date, supplier_id, supplier_name, location_id, status, subtotal, tax, total, notes, reference, created_by, payment_status, amount_paid)
  values (q.tenant_id, public.next_doc_number('po', q.tenant_id), current_date, q.needed_by, s.id, s.name,
          coalesce(q.location_id, (select id from public.locations where tenant_id = q.tenant_id and is_main limit 1)),
          'draft', 0, 0, 0, 'From ' || coalesce(q.number, 'RFQ') || coalesce(case when quote.lead_days is not null then ' · lead time ' || quote.lead_days || ' days' end, '') || coalesce(' · ' || quote.delivery_terms, ''), q.number, auth.uid(), 'unpaid', 0)
  returning id into po;
  for l in select value from jsonb_array_elements(coalesce(q.lines, '[]'::jsonb)) loop
    qty := coalesce((l->>'quantity')::numeric, 0);
    if qty > 0 then
      ql := (select x from jsonb_array_elements(coalesce(quote.lines, '[]'::jsonb)) x
              where (l->>'product_id' is not null and x->>'product_id' = l->>'product_id') or coalesce((x->>'line')::int, -1) = i limit 1);
      price := coalesce(nullif((ql->>'unit_price')::numeric, 0), (l->>'est_unit_cost')::numeric, 0);
      pid := nullif(l->>'product_id', '')::uuid;
      if pid is null then pid := public._req_line_product(q.tenant_id, l->>'name', l->>'unit', price); end if;
      insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, total, received_quantity) values (po, pid, ceil(qty)::int, price, ceil(qty) * price, 0);
      tot := tot + ceil(qty) * price;
    end if;
    i := i + 1;
  end loop;
  update public.purchases set subtotal = tot, total = tot where id = po;
  insert into public.documents (tenant_id, entity_type, entity_id, entity_name, name, category, path, url, mime_type, size_bytes, notes, uploaded_by, uploaded_by_name, folder_id)
  select tenant_id, 'purchase_order', po, (select po_number from public.purchases where id = po), name, coalesce(category, 'Quotation'), path, url, mime_type, size_bytes,
         coalesce(notes, 'From ' || coalesce(q.number, 'the RFQ')), uploaded_by, uploaded_by_name, null
    from public.documents where tenant_id = q.tenant_id and entity_type = 'rfq' and entity_id = p_rfq;
  update public.rfqs set status = 'awarded', awarded_supplier_id = s.id, purchase_id = po where id = p_rfq;
  if q.requisition_id is not null then
    update public.requisitions set purchase_id = po, supplier_id = s.id, supplier_name = s.name, status = 'ordered', updated_at = now() where id = q.requisition_id and purchase_id is null;
    perform public._req_log(q.requisition_id, 'ordered', 'Purchase order created from ' || coalesce(q.number, 'the RFQ') || ' for ' || s.name);
  end if;
  return po;
end $$;

grant execute on function public.requisition_to_po(uuid) to authenticated;
grant execute on function public.requisition_to_rfq(uuid) to authenticated;
grant execute on function public.requisition_to_expense(uuid, text, text, date, text) to authenticated;
grant execute on function public.rfq_to_po(uuid, uuid) to authenticated;
revoke execute on function public._req_line_product(uuid, text, text, numeric) from public, anon, authenticated;

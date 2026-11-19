-- JMSURF DASH v3 (2026-10-06)
--  * opening stock: 5 of every product at the main location, reorder level 2
--  * M-Pesa prompts for invoices from the customer portal (JMSURF PAY)
--  * approvals for quotes, invoices, POs, bills, expenses, credit notes, requisitions, payroll
--  * purchasing: PO numbers, purchase receives, PO → bill (draft/open)
--  * documents module (private files for customers, suppliers, employees, leave …)
--  * stock alert log, supplier onboarding details, leave resubmission
-- Apply as supabase_admin in one transaction.

-- =====================================================================
-- Opening stock (only products that have never had stock recorded)
-- =====================================================================
update public.products set reorder_level = 2 where reorder_level = 5 or reorder_level is null;
insert into public.product_stocks (product_id, location_id, stock, reorder_level)
select p.id, l.id, 5, 2
  from public.products p
  join lateral (select id from public.locations where tenant_id = p.tenant_id order by is_main desc, created_at limit 1) l on true
 where not exists (select 1 from public.product_stocks s where s.product_id = p.id)
on conflict (product_id, location_id) do nothing;
insert into public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after, reason)
select s.product_id, s.location_id, 5, 0, 5, 'opening_stock'
  from public.product_stocks s
 where s.stock = 5 and not exists (select 1 from public.stock_adjustments a where a.product_id = s.product_id);

create table if not exists public.stock_alert_log (
  tenant_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null,
  alerted_on date not null default current_date,
  primary key (product_id, kind, alerted_on)
);
alter table public.stock_alert_log enable row level security;

-- =====================================================================
-- Invoice payments by M-Pesa prompt (portal and ERP)
-- =====================================================================
create table if not exists public.invoice_mpesa_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid,
  phone text not null,
  amount numeric not null check (amount >= 1),
  checkout_request_id text unique,
  status text not null default 'initiating' check (status in ('initiating', 'pending', 'completed', 'failed', 'cancelled')),
  mpesa_receipt text,
  provider_status jsonb,
  payment_id uuid,
  requested_by text not null default 'portal',
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  settled_at timestamptz
);
create index if not exists imr_pending_idx on public.invoice_mpesa_requests (status, created_at) where status in ('initiating', 'pending');
alter table public.invoice_mpesa_requests enable row level security;
drop policy if exists imr_read on public.invoice_mpesa_requests;
create policy imr_read on public.invoice_mpesa_requests for select to authenticated using (tenant_id = public.current_user_tenant_id());
grant select on public.invoice_mpesa_requests to authenticated;

/** Server-side: a confirmed M-Pesa prompt becomes a payment applied to its invoice (once). */
create or replace function public.settle_invoice_mpesa(p_request uuid, p_status text, p_receipt text, p_provider jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare r public.invoice_mpesa_requests; i public.invoices; num text; pid uuid; amt numeric;
begin
  select * into r from public.invoice_mpesa_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status = 'completed' then return 'completed'; end if;
  if p_status <> 'completed' then
    update public.invoice_mpesa_requests set status = p_status, provider_status = p_provider, checked_at = now() where id = r.id;
    return p_status;
  end if;
  select * into i from public.invoices where id = r.invoice_id for update;
  amt := least(r.amount, greatest(0, i.total - i.amount_paid));
  num := public.next_doc_number('payment', r.tenant_id);
  insert into public.payments_received (tenant_id, payment_number, customer_id, customer_name, payment_date, amount, method, reference, notes, received_by_name)
  values (r.tenant_id, num, i.customer_id, i.customer_name, current_date, r.amount, 'mpesa', p_receipt, 'M-Pesa prompt for ' || i.invoice_number, 'M-Pesa (JMSURF PAY)')
  returning id into pid;
  if amt > 0 then insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount) values (r.tenant_id, pid, i.id, amt); end if;
  update public.invoice_mpesa_requests set status = 'completed', mpesa_receipt = p_receipt, provider_status = p_provider, payment_id = pid, settled_at = now(), checked_at = now() where id = r.id;
  insert into public.shop_notifications (tenant_id, kind, title, body, link, role, entity_type, entity_id)
  values (r.tenant_id, 'payment', 'M-Pesa payment received for ' || i.invoice_number, coalesce(i.customer_name, '') || ' paid KES ' || r.amount || ' · ' || p_receipt, '/sales/invoices/' || i.id, 'admin', 'invoice', i.id);
  return 'completed';
end $$;
revoke all on function public.settle_invoice_mpesa(uuid, text, text, jsonb) from public, anon, authenticated;

-- =====================================================================
-- Approvals
-- =====================================================================
create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  doc_type text not null,
  doc_id uuid not null,
  doc_number text,
  title text,
  amount numeric,
  requested_by uuid default auth.uid(),
  requested_by_name text,
  approvers uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists approval_requests_open_idx on public.approval_requests (tenant_id, status, created_at desc);
create index if not exists approval_requests_doc_idx on public.approval_requests (doc_type, doc_id);
alter table public.approval_requests enable row level security;
drop policy if exists approval_requests_read on public.approval_requests;
create policy approval_requests_read on public.approval_requests for select to authenticated using (tenant_id = public.current_user_tenant_id());
grant select on public.approval_requests to authenticated;

alter table public.quotes add column if not exists approval_status text not null default 'not_required';
alter table public.invoices add column if not exists approval_status text not null default 'not_required';
alter table public.purchases add column if not exists approval_status text not null default 'not_required';
alter table public.bills add column if not exists approval_status text not null default 'not_required';
alter table public.expenses add column if not exists approval_status text not null default 'not_required';
alter table public.credit_notes add column if not exists approval_status text not null default 'not_required';
alter table public.hr_payroll_runs add column if not exists approval_status text not null default 'not_required';
alter table public.requisitions add column if not exists approval_status text not null default 'not_required';

/** Which table holds each document type. */
create or replace function public._approval_table(p_type text) returns text language sql immutable as $$
  select case p_type when 'quote' then 'quotes' when 'invoice' then 'invoices' when 'purchase_order' then 'purchases' when 'bill' then 'bills'
    when 'expense' then 'expenses' when 'credit_note' then 'credit_notes' when 'payroll' then 'hr_payroll_runs' when 'requisition' then 'requisitions' end
$$;

/** Puts a document up for approval by the approvers set in System → Approvals. */
create or replace function public.submit_for_approval(p_type text, p_doc uuid, p_number text, p_title text, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); tbl text := public._approval_table(p_type); cfg jsonb; ids uuid[]; rid uuid; nm text; u uuid;
begin
  if tbl is null then raise exception 'Unknown document type'; end if;
  if t is null then raise exception 'Sign in first'; end if;
  execute format('select 1 from public.%I where id = $1 and tenant_id = $2', tbl) using p_doc, t;
  if not found then raise exception 'Document not found'; end if;
  select erp_settings->'approvals'->p_type into cfg from public.business_settings where tenant_id = t;
  select array_agg(x::uuid) into ids from jsonb_array_elements_text(coalesce(cfg->'approvers', '[]'::jsonb)) x;
  if ids is null or cardinality(ids) = 0 then
    select array_agg(ur.user_id) into ids from public.user_roles ur join public.profiles p on p.user_id = ur.user_id where p.tenant_id = t and ur.role = 'admin';
  end if;
  update public.approval_requests set status = 'cancelled' where doc_type = p_type and doc_id = p_doc and status = 'pending';
  select display_name into nm from public.profiles where user_id = auth.uid();
  insert into public.approval_requests (tenant_id, doc_type, doc_id, doc_number, title, amount, requested_by_name, approvers)
  values (t, p_type, p_doc, p_number, p_title, p_amount, nm, coalesce(ids, '{}')) returning id into rid;
  execute format('update public.%I set approval_status = %L where id = $1', tbl, 'pending') using p_doc;
  foreach u in array coalesce(ids, '{}') loop
    insert into public.shop_notifications (tenant_id, kind, title, body, link, user_id, entity_type, entity_id)
    values (t, 'approval', 'Approval needed: ' || coalesce(p_number, p_type), coalesce(nm, 'Someone') || ' sent ' || replace(p_type, '_', ' ') || coalesce(' ' || p_number, '') || coalesce(' (KES ' || round(p_amount) || ')', '') || ' for approval.', '/approvals', u, 'approval', rid);
  end loop;
  return rid;
end $$;
grant execute on function public.submit_for_approval(text, uuid, text, text, numeric) to authenticated;

create or replace function public.decide_approval(p_request uuid, p_approve boolean, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.approval_requests; tbl text; nm text;
begin
  select * into r from public.approval_requests where id = p_request and tenant_id = public.current_user_tenant_id() for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request was already decided'; end if;
  if not (auth.uid() = any(r.approvers) or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'You are not an approver for this document';
  end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Say why it is rejected'; end if;
  select display_name into nm from public.profiles where user_id = auth.uid();
  update public.approval_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_by_name = nm, decided_at = now(), comment = nullif(trim(p_comment), '') where id = r.id;
  tbl := public._approval_table(r.doc_type);
  execute format('update public.%I set approval_status = %L where id = $1', tbl, case when p_approve then 'approved' else 'rejected' end) using r.doc_id;
  if r.doc_type = 'requisition' then
    update public.requisitions set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_by_name = nm, approved_at = now(), rejection_reason = case when p_approve then null else p_comment end where id = r.doc_id;
  end if;
  if r.requested_by is not null then
    insert into public.shop_notifications (tenant_id, kind, title, body, link, user_id, entity_type, entity_id)
    values (r.tenant_id, 'approval', coalesce(r.doc_number, replace(r.doc_type, '_', ' ')) || case when p_approve then ' approved' else ' rejected' end,
            coalesce(nm, '') || coalesce(': ' || nullif(trim(p_comment), ''), ''), '/approvals', r.requested_by, 'approval', r.id);
  end if;
end $$;
grant execute on function public.decide_approval(uuid, boolean, text) to authenticated;

-- =====================================================================
-- Purchasing (style)
-- =====================================================================
alter table public.purchases
  add column if not exists po_number text,
  add column if not exists order_date date not null default current_date,
  add column if not exists expected_date date,
  add column if not exists reference text,
  add column if not exists terms text,
  add column if not exists billed boolean not null default false;
update public.purchases set po_number = 'PO-' || lpad((row_number)::text, 6, '0')
  from (select id, row_number() over (order by created_at) from public.purchases where po_number is null) x where x.id = purchases.id;

alter table public.bills
  add column if not exists bill_number text,
  add column if not exists bill_date date not null default current_date,
  add column if not exists due_date date,
  add column if not exists reference text,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists subtotal numeric not null default 0,
  add column if not exists tax numeric not null default 0,
  add column if not exists payment_terms text;

create table if not exists public.purchase_receives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receive_number text,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  supplier_id uuid,
  supplier_name text,
  received_date date not null default current_date,
  notes text,
  items jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table public.purchase_receives enable row level security;
drop policy if exists purchase_receives_read on public.purchase_receives;
create policy purchase_receives_read on public.purchase_receives for select to authenticated using (tenant_id = public.current_user_tenant_id());
grant select on public.purchase_receives to authenticated;

-- Receiving no longer raises a bill by itself: bills come from "Convert to bill" on the PO.
create or replace function public.receive_purchase(p_purchase uuid, p_lines jsonb, p_update_cost boolean DEFAULT true)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
DECLARE po public.purchases%ROWTYPE; l jsonb; it public.purchase_items%ROWTYPE; _qty numeric; _before numeric; _after numeric;
        _lines int := 0; _left numeric; _items jsonb := '[]'::jsonb; _num text; _name text; _rid uuid;
BEGIN
  SELECT * INTO po FROM public.purchases WHERE id = p_purchase FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT public._can_manage_purchases(po.tenant_id) THEN RAISE EXCEPTION 'You are not allowed to receive stock'; END IF;
  IF po.status = 'received' THEN RAISE EXCEPTION 'This order is already fully received'; END IF;
  IF po.approval_status = 'pending' THEN RAISE EXCEPTION 'This order is waiting for approval'; END IF;
  IF po.approval_status = 'rejected' THEN RAISE EXCEPTION 'This order was rejected'; END IF;
  IF po.location_id IS NULL THEN RAISE EXCEPTION 'This order has no branch'; END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    _qty := coalesce((l->>'quantity')::numeric, 0);
    CONTINUE WHEN _qty = 0;
    SELECT * INTO it FROM public.purchase_items WHERE id = (l->>'item_id')::uuid AND purchase_id = p_purchase FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A line does not belong to this order'; END IF;
    IF _qty < 0 OR _qty > it.quantity - it.received_quantity + 0.0001 THEN
      RAISE EXCEPTION 'Receiving % but only % of this line is still to come', _qty, it.quantity - it.received_quantity;
    END IF;
    IF it.variant_id IS NOT NULL THEN
      SELECT stock INTO _before FROM public.product_variants WHERE id = it.variant_id FOR UPDATE;
      _after := coalesce(_before, 0) + _qty;
      UPDATE public.product_variants SET stock = _after,
        cost_price = CASE WHEN p_update_cost AND it.unit_cost > 0 THEN it.unit_cost ELSE cost_price END WHERE id = it.variant_id;
    ELSE
      INSERT INTO public.product_stocks (product_id, location_id, stock) VALUES (it.product_id, po.location_id, 0) ON CONFLICT (product_id, location_id) DO NOTHING;
      SELECT stock INTO _before FROM public.product_stocks WHERE product_id = it.product_id AND location_id = po.location_id FOR UPDATE;
      _after := coalesce(_before, 0) + _qty;
      UPDATE public.product_stocks SET stock = _after WHERE product_id = it.product_id AND location_id = po.location_id;
    END IF;
    IF p_update_cost AND it.unit_cost > 0 THEN UPDATE public.products SET cost_price = it.unit_cost WHERE id = it.product_id; END IF;
    INSERT INTO public.stock_adjustments (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
    VALUES (it.product_id, it.variant_id, po.location_id, _qty, coalesce(_before, 0), _after, 'purchase_received', auth.uid());
    UPDATE public.purchase_items SET received_quantity = received_quantity + _qty WHERE id = it.id;
    _items := _items || jsonb_build_object('item_id', it.id, 'product_id', it.product_id, 'name', (SELECT name FROM public.products WHERE id = it.product_id), 'quantity', _qty, 'ordered', it.quantity);
    _lines := _lines + 1;
  END LOOP;
  IF _lines = 0 THEN RAISE EXCEPTION 'Choose at least one item and quantity to receive'; END IF;

  SELECT coalesce(sum(quantity - received_quantity), 0) INTO _left FROM public.purchase_items WHERE purchase_id = p_purchase;
  UPDATE public.purchases SET status = CASE WHEN _left <= 0.0001 THEN 'received' ELSE 'partially_received' END, received_at = now() WHERE id = p_purchase;
  _num := public.next_doc_number('purchase_receive', po.tenant_id);
  SELECT display_name INTO _name FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.purchase_receives (tenant_id, receive_number, purchase_id, supplier_id, supplier_name, items, created_by_name)
  VALUES (po.tenant_id, _num, po.id, po.supplier_id, po.supplier_name, _items, _name) RETURNING id INTO _rid;
  RETURN jsonb_build_object('lines', _lines, 'status', CASE WHEN _left <= 0.0001 THEN 'received' ELSE 'partially_received' END, 'remaining', _left, 'receive_id', _rid, 'receive_number', _num);
END $function$;

/** PO → bill: billed quantities are what was received (or everything ordered when nothing was received yet). */
create or replace function public.convert_po_to_bill(p_purchase uuid, p_status text, p_bill_date date, p_due_date date, p_reference text)
returns uuid language plpgsql security definer set search_path = public as $$
declare po public.purchases; it record; items jsonb := '[]'::jsonb; sub numeric := 0; num text; bid uuid; anyrecv boolean; q numeric;
begin
  select * into po from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not public._can_manage_purchases(po.tenant_id) then raise exception 'You are not allowed to create bills'; end if;
  if po.approval_status in ('pending', 'rejected') then raise exception 'Approve the purchase order first'; end if;
  if exists (select 1 from public.bills where purchase_id = p_purchase and status <> 'void') then raise exception 'This purchase order already has a bill'; end if;
  select bool_or(received_quantity > 0) into anyrecv from public.purchase_items where purchase_id = p_purchase;
  for it in select pi.*, p.name from public.purchase_items pi left join public.products p on p.id = pi.product_id where pi.purchase_id = p_purchase loop
    q := case when coalesce(anyrecv, false) then it.received_quantity else it.quantity end;
    continue when q <= 0;
    items := items || jsonb_build_object('product_id', it.product_id, 'name', coalesce(it.name, 'Item'), 'quantity', q, 'rate', it.unit_cost, 'amount', round(q * it.unit_cost, 2));
    sub := sub + q * it.unit_cost;
  end loop;
  num := public.next_doc_number('bill', po.tenant_id);
  insert into public.bills (tenant_id, name, bill_number, category, amount, subtotal, status, supplier_id, location_id, purchase_id, created_by, notes, bill_date, due_date, reference, items)
  values (po.tenant_id, coalesce(nullif(po.supplier_name, ''), 'Supplier') || ' · ' || coalesce(po.po_number, 'PO'), num, 'Purchase Order', round(sub, 2), round(sub, 2),
          case when p_status = 'draft' then 'draft' else 'pending' end, po.supplier_id, po.location_id, po.id, auth.uid(), 'From ' || coalesce(po.po_number, 'purchase order'),
          coalesce(p_bill_date, current_date), p_due_date, nullif(trim(p_reference), ''), items)
  returning id into bid;
  update public.purchases set billed = true where id = po.id;
  return bid;
end $$;
grant execute on function public.convert_po_to_bill(uuid, text, date, date, text) to authenticated;

create or replace function public.doc_prefix_default(p_kind text) returns text language sql immutable as $$
  select case p_kind
    when 'quote' then 'QT-' when 'invoice' then 'INV-' when 'payment' then 'PR-' when 'receipt' then 'SR-'
    when 'credit_note' then 'CN-' when 'po' then 'PO-' when 'bill' then 'BILL-' when 'requisition' then 'REQ-'
    when 'delivery_note' then 'DN-' when 'packing_list' then 'PL-' when 'lead' then 'LD-' when 'web_order' then 'WEB-' when 'employee' then 'EMP-'
    when 'payroll' then 'PAY-' when 'purchase_receive' then 'GRN-' when 'expense' then 'EXP-' when 'supplier_payment' then 'SP-' else upper(left(p_kind, 3)) || '-' end
$$;
-- Next PO number continues after the numbered ones above.
insert into public.doc_sequences (tenant_id, kind, prefix, next_value)
select t.id, 'po', 'PO-', coalesce((select count(*) from public.purchases p where p.tenant_id = t.id), 0) + 1 from public.tenants t
on conflict (tenant_id, kind) do update set next_value = greatest(public.doc_sequences.next_value, excluded.next_value);

-- =====================================================================
-- Suppliers: onboarding details
-- =====================================================================
alter table public.suppliers
  add column if not exists contact_person text,
  add column if not exists kra_pin text,
  add column if not exists registration_no text,
  add column if not exists website text,
  add column if not exists payment_terms text,
  add column if not exists bank_details text,
  add column if not exists category text,
  add column if not exists onboarding_status text not null default 'active';

-- =====================================================================
-- Documents module
-- =====================================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null default 'general',
  entity_id uuid,
  entity_name text,
  name text not null,
  category text,
  path text,
  url text,
  mime_type text,
  size_bytes bigint,
  expires_on date,
  notes text,
  uploaded_by uuid default auth.uid(),
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists documents_entity_idx on public.documents (tenant_id, entity_type, entity_id);
alter table public.documents enable row level security;
drop policy if exists documents_rw on public.documents;
create policy documents_rw on public.documents for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit) values ('documents', 'documents', false, 20971520) on conflict (id) do nothing;
drop policy if exists "documents tenant read" on storage.objects;
drop policy if exists "documents tenant write" on storage.objects;
drop policy if exists "documents tenant delete" on storage.objects;
create policy "documents tenant read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.current_user_tenant_id()::text);
create policy "documents tenant write" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = public.current_user_tenant_id()::text);
create policy "documents tenant delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.current_user_tenant_id()::text and public.can_manage_shop());

-- =====================================================================
-- Leave: staff amend and resubmit their own requests; attachment
-- =====================================================================
alter table public.hr_leave_requests
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists history jsonb not null default '[]'::jsonb,
  add column if not exists requested_by uuid default auth.uid();
drop policy if exists hr_leave_self_update on public.hr_leave_requests;
create policy hr_leave_self_update on public.hr_leave_requests for update to authenticated
  using (status in ('pending', 'rejected') and employee_id in (select id from public.hr_employees where user_id = auth.uid()))
  with check (status in ('pending', 'cancelled') and employee_id in (select id from public.hr_employees where user_id = auth.uid()));
drop policy if exists hr_employees_self_read_names on public.hr_employees;

-- Realtime for approvals and invoice payments.
do $$
declare t text;
begin
  foreach t in array array['approval_requests','invoice_mpesa_requests','documents','purchase_receives'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;

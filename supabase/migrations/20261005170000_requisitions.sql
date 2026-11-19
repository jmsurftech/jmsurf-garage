-- JMSURF DASH: supply-chain requisitions.
-- Attendant drafts a requisition to a supplier -> submits -> manager edits and
-- approves (or rejects) -> attendant is notified, sends it to the supplier by
-- email / WhatsApp and follows up -> it becomes a purchase order that is
-- received into stock on the Purchase Orders page.

create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'sent', 'acknowledged', 'ordered', 'received', 'cancelled')),
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text,
  location_id uuid references public.locations(id) on delete set null,
  needed_by date,
  notes text,
  manager_notes text,
  rejection_reason text,
  requested_by uuid,
  requested_by_name text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  sent_at timestamptz,
  sent_via text,
  follow_up_on date,
  purchase_id uuid references public.purchases(id) on delete set null,
  total_estimate numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists requisitions_tenant_idx on public.requisitions (tenant_id, status, created_at desc);

create table if not exists public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  unit text,
  qty_requested numeric not null check (qty_requested > 0),
  qty_approved numeric,
  est_unit_cost numeric not null default 0,
  notes text,
  sort integer not null default 0
);
create index if not exists requisition_items_req_idx on public.requisition_items (requisition_id);

create table if not exists public.requisition_events (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  note text,
  by_user uuid,
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists requisition_events_req_idx on public.requisition_events (requisition_id, created_at);

alter table public.requisitions enable row level security;
alter table public.requisition_items enable row level security;
alter table public.requisition_events enable row level security;
do $$ declare t text; begin
  foreach t in array array['requisitions', 'requisition_items', 'requisition_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = public.current_user_tenant_id())', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Drafts are written directly by their author; every status change goes through the functions below.
drop policy if exists requisitions_write on public.requisitions;
create policy requisitions_write on public.requisitions for insert to authenticated
  with check (tenant_id = public.current_user_tenant_id() and status = 'draft' and requested_by = auth.uid());
drop policy if exists requisitions_edit_draft on public.requisitions;
create policy requisitions_edit_draft on public.requisitions for update to authenticated
  using (tenant_id = public.current_user_tenant_id() and status in ('draft', 'rejected') and requested_by = auth.uid())
  with check (tenant_id = public.current_user_tenant_id() and status in ('draft', 'rejected'));
drop policy if exists requisitions_delete_draft on public.requisitions;
create policy requisitions_delete_draft on public.requisitions for delete to authenticated
  using (tenant_id = public.current_user_tenant_id() and status = 'draft' and (requested_by = auth.uid() or public.has_role(auth.uid(), 'admin')));
drop policy if exists requisition_items_write on public.requisition_items;
create policy requisition_items_write on public.requisition_items for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and exists (select 1 from public.requisitions r where r.id = requisition_id and r.status in ('draft', 'rejected') and r.requested_by = auth.uid()))
  with check (tenant_id = public.current_user_tenant_id() and exists (select 1 from public.requisitions r where r.id = requisition_id and r.status in ('draft', 'rejected') and r.requested_by = auth.uid()));
grant insert, update, delete on public.requisitions, public.requisition_items to authenticated;

create or replace function public._req_is_manager() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'super_admin')
$$;
create or replace function public._me_name() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.profiles where user_id = auth.uid()), 'Staff')
$$;
create or replace function public._req_log(p_req uuid, p_kind text, p_note text) returns void
language sql security definer set search_path = public as $$
  insert into public.requisition_events (requisition_id, tenant_id, kind, note, by_user, by_name)
  select p_req, r.tenant_id, p_kind, p_note, auth.uid(), public._me_name() from public.requisitions r where r.id = p_req
$$;
create or replace function public._req_refresh_total(p_req uuid) returns void language sql security definer set search_path = public as $$
  update public.requisitions set total_estimate = coalesce((select sum(coalesce(qty_approved, qty_requested) * est_unit_cost) from public.requisition_items where requisition_id = p_req), 0), updated_at = now() where id = p_req
$$;

/** Attendant submits a draft (or a rejected one, after fixing it) for approval. */
create or replace function public.requisition_submit(p_req uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requisitions;
begin
  select * into r from public.requisitions where id = p_req and tenant_id = public.current_user_tenant_id();
  if not found then raise exception 'Requisition not found'; end if;
  if r.status not in ('draft', 'rejected') then raise exception 'Only a draft can be submitted'; end if;
  if not exists (select 1 from public.requisition_items where requisition_id = p_req) then raise exception 'Add at least one item'; end if;
  if r.number is null then update public.requisitions set number = public.next_doc_number('requisition', r.tenant_id) where id = p_req; end if;
  perform public._req_refresh_total(p_req);
  update public.requisitions set status = 'pending_approval', rejection_reason = null, updated_at = now() where id = p_req;
  perform public._req_log(p_req, 'submitted', null);
  insert into public.shop_notifications (tenant_id, kind, title, body, link, role, entity_type, entity_id)
  select r.tenant_id, 'requisition', 'Requisition waiting for approval',
         public._me_name() || ' asked for stock from ' || coalesce(r.supplier_name, 'a supplier') || ' (' || (select number from public.requisitions where id = p_req) || ').',
         '/purchases/requisitions/' || p_req, x.role, 'requisition', p_req
    from (values ('admin'), ('manager')) x(role);
end $$;

/**
 * Manager approves (with any edited quantities, supplier or costs) or rejects.
 * p_lines: [{id, qty_approved, est_unit_cost}] for edits.
 */
create or replace function public.requisition_decide(p_req uuid, p_approve boolean, p_note text default null, p_lines jsonb default '[]'::jsonb, p_supplier uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requisitions; l jsonb; sname text;
begin
  if not public._req_is_manager() then raise exception 'Only a manager or the owner can approve requisitions'; end if;
  select * into r from public.requisitions where id = p_req and tenant_id = public.current_user_tenant_id();
  if not found then raise exception 'Requisition not found'; end if;
  if r.status <> 'pending_approval' then raise exception 'This requisition is not waiting for approval'; end if;
  for l in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update public.requisition_items set
      qty_approved = greatest(coalesce((l->>'qty_approved')::numeric, qty_requested), 0),
      est_unit_cost = coalesce((l->>'est_unit_cost')::numeric, est_unit_cost)
    where id = (l->>'id')::uuid and requisition_id = p_req;
  end loop;
  if p_supplier is not null then
    select name into sname from public.suppliers where id = p_supplier and tenant_id = r.tenant_id;
    update public.requisitions set supplier_id = p_supplier, supplier_name = sname where id = p_req;
  end if;
  if p_approve then
    update public.requisition_items set qty_approved = coalesce(qty_approved, qty_requested) where requisition_id = p_req;
    perform public._req_refresh_total(p_req);
    update public.requisitions set status = 'approved', approved_by = auth.uid(), approved_by_name = public._me_name(), approved_at = now(),
      manager_notes = coalesce(nullif(trim(p_note), ''), manager_notes), updated_at = now() where id = p_req;
    perform public._req_log(p_req, 'approved', p_note);
  else
    update public.requisitions set status = 'rejected', rejection_reason = coalesce(nullif(trim(p_note), ''), 'Not approved'), updated_at = now() where id = p_req;
    perform public._req_log(p_req, 'rejected', p_note);
  end if;
  insert into public.shop_notifications (tenant_id, kind, title, body, link, user_id, entity_type, entity_id)
  values (r.tenant_id, 'requisition',
          case when p_approve then 'Requisition approved: send it to the supplier' else 'Requisition not approved' end,
          coalesce(r.number, 'Your requisition') || case when p_approve then ' was approved by ' || public._me_name() || '. Send it to ' || coalesce(sname, r.supplier_name, 'the supplier') || ' and follow up.' else ' was returned: ' || coalesce(nullif(trim(p_note), ''), 'see the notes') end,
          '/purchases/requisitions/' || p_req, r.requested_by, 'requisition', p_req);
end $$;

/** Record that the approved requisition went to the supplier (and when to follow up). */
create or replace function public.requisition_mark_sent(p_req uuid, p_via text, p_follow_up date default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requisitions;
begin
  select * into r from public.requisitions where id = p_req and tenant_id = public.current_user_tenant_id();
  if not found then raise exception 'Requisition not found'; end if;
  if r.status not in ('approved', 'sent', 'acknowledged') then raise exception 'Only an approved requisition can be sent'; end if;
  update public.requisitions set status = case when status = 'approved' then 'sent' else status end, sent_at = coalesce(sent_at, now()),
    sent_via = case when sent_via is null or sent_via = p_via then p_via else 'email+whatsapp' end,
    follow_up_on = coalesce(p_follow_up, follow_up_on, current_date + 2), updated_at = now() where id = p_req;
  perform public._req_log(p_req, 'sent', 'Sent by ' || p_via);
end $$;

/** Follow-up note, optionally marking that the supplier confirmed. */
create or replace function public.requisition_follow_up(p_req uuid, p_note text, p_acknowledged boolean default false, p_next date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.requisitions where id = p_req and tenant_id = public.current_user_tenant_id()) then raise exception 'Requisition not found'; end if;
  update public.requisitions set status = case when p_acknowledged and status = 'sent' then 'acknowledged' else status end,
    follow_up_on = p_next, updated_at = now() where id = p_req;
  perform public._req_log(p_req, case when p_acknowledged then 'acknowledged' else 'followed_up' end, p_note);
end $$;

/** Turn an approved / sent requisition into a purchase order (received on the Purchase Orders page). */
create or replace function public.requisition_to_po(p_req uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.requisitions; po uuid; tot numeric;
begin
  select * into r from public.requisitions where id = p_req and tenant_id = public.current_user_tenant_id();
  if not found then raise exception 'Requisition not found'; end if;
  if r.purchase_id is not null then return r.purchase_id; end if;
  if r.status not in ('approved', 'sent', 'acknowledged') then raise exception 'Approve the requisition first'; end if;
  if coalesce(r.supplier_name, '') = '' then raise exception 'Choose the supplier first: a manager can set it under Review & approve'; end if;
  if exists (select 1 from public.requisition_items where requisition_id = p_req and product_id is null and coalesce(qty_approved, qty_requested) > 0) then
    raise exception 'Every line needs a product from Items before it can be received into stock';
  end if;
  select coalesce(sum(coalesce(qty_approved, qty_requested) * est_unit_cost), 0) into tot from public.requisition_items where requisition_id = p_req;
  insert into public.purchases (tenant_id, supplier_id, supplier_name, location_id, status, subtotal, tax, total, notes, created_by, payment_status, amount_paid)
  values (r.tenant_id, r.supplier_id, r.supplier_name, coalesce(r.location_id, (select id from public.locations where tenant_id = r.tenant_id and is_main limit 1)),
          'pending', tot, 0, tot, 'From requisition ' || coalesce(r.number, ''), auth.uid(), 'unpaid', 0)
  returning id into po;
  insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, total, received_quantity)
  select po, product_id, ceil(coalesce(qty_approved, qty_requested))::int, est_unit_cost, ceil(coalesce(qty_approved, qty_requested)) * est_unit_cost, 0
    from public.requisition_items where requisition_id = p_req and coalesce(qty_approved, qty_requested) > 0;
  update public.requisitions set status = 'ordered', purchase_id = po, updated_at = now() where id = p_req;
  perform public._req_log(p_req, 'ordered', 'Purchase order created');
  return po;
end $$;

do $$ declare f text; begin
  foreach f in array array['requisition_submit(uuid)', 'requisition_decide(uuid, boolean, text, jsonb, uuid)', 'requisition_mark_sent(uuid, text, date)',
                           'requisition_follow_up(uuid, text, boolean, date)', 'requisition_to_po(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- Received purchase orders close their requisition.
create or replace function public.requisition_po_received() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'received' and old.status is distinct from 'received' then
    update public.requisitions set status = 'received', updated_at = now() where purchase_id = new.id and status <> 'received';
  end if;
  return new;
end $$;
drop trigger if exists requisition_po_received on public.purchases;
create trigger requisition_po_received after update of status on public.purchases for each row execute function public.requisition_po_received();

alter publication supabase_realtime add table public.requisitions;

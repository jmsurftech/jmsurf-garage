-- CRM ↔ Books: quotes, sales orders and invoices carry the deal they belong to, and a deal moves
-- forward by itself as its documents do. Workflow rules for deals and contacts, with task and
-- round-robin assignment actions. Website lead forms. Live updates for the CRM tables.

alter table public.quotes add column if not exists deal_id uuid references public.crm_deals(id) on delete set null;
alter table public.sales_orders add column if not exists deal_id uuid references public.crm_deals(id) on delete set null;
alter table public.invoices add column if not exists deal_id uuid references public.crm_deals(id) on delete set null;
create index if not exists quotes_deal_idx on public.quotes (deal_id) where deal_id is not null;
create index if not exists sales_orders_deal_idx on public.sales_orders (deal_id) where deal_id is not null;
create index if not exists invoices_deal_idx on public.invoices (deal_id) where deal_id is not null;

/**
 * A document of a deal moves the deal on (never back): a quote → Proposal, an accepted quote or a
 * sales order → Negotiation, an invoice → Won. An invoice made from a quote inherits the quote's deal.
 * An empty deal amount takes the document's total.
 */
create or replace function public.crm_deal_follow_doc() returns trigger language plpgsql security definer set search_path = public as $$
declare _deal public.crm_deals; _to text; _order text[] := array['qualification','needs_analysis','value_proposition','decision_makers','proposal','negotiation','won'];
begin
  if new.deal_id is null and tg_table_name in ('invoices', 'sales_orders') and (to_jsonb(new) ->> 'quote_id') is not null then
    select deal_id into new.deal_id from public.quotes where id = (to_jsonb(new) ->> 'quote_id')::uuid;
  end if;
  if new.deal_id is null then return new; end if;
  _to := case tg_table_name
    when 'quotes' then case when new.status in ('accepted', 'invoiced') then 'negotiation' when new.status in ('declined', 'expired') then null else 'proposal' end
    when 'sales_orders' then case when new.status in ('declined', 'void', 'cancelled') then null else 'negotiation' end
    when 'invoices' then case when new.status = 'void' or new.status = 'draft' then null else 'won' end
  end;
  select * into _deal from public.crm_deals where id = new.deal_id;
  if _deal.id is null or _deal.tenant_id <> new.tenant_id then new.deal_id := null; return new; end if;
  if _to is not null and _deal.stage <> 'lost' and coalesce(array_position(_order, _to), 0) > coalesce(array_position(_order, _deal.stage), 0) then
    update public.crm_deals set stage = _to,
           probability = case _to when 'proposal' then 75 when 'negotiation' then 90 when 'won' then 100 else probability end,
           closed_at = case when _to = 'won' then now() else closed_at end,
           amount = case when coalesce(amount, 0) = 0 then coalesce(new.total, 0) else amount end,
           quote_id = case when tg_table_name = 'quotes' then new.id else quote_id end,
           updated_at = now()
     where id = _deal.id;
  elsif coalesce(_deal.amount, 0) = 0 and coalesce(new.total, 0) > 0 then
    update public.crm_deals set amount = new.total, updated_at = now() where id = _deal.id;
  end if;
  return new;
end $$;
drop trigger if exists crm_deal_follow_doc on public.quotes;
create trigger crm_deal_follow_doc before insert or update of status, deal_id on public.quotes for each row execute function public.crm_deal_follow_doc();
drop trigger if exists crm_deal_follow_doc on public.sales_orders;
create trigger crm_deal_follow_doc before insert or update of status, deal_id on public.sales_orders for each row execute function public.crm_deal_follow_doc();
drop trigger if exists crm_deal_follow_doc on public.invoices;
create trigger crm_deal_follow_doc before insert or update of status, deal_id on public.invoices for each row execute function public.crm_deal_follow_doc();

-- Workflow rules on deals and contacts too.
alter table public.workflow_rules drop constraint if exists workflow_rules_module_check;
alter table public.workflow_rules add constraint workflow_rules_module_check
  check (module = any (array['invoices','quotes','sales_orders','bills','customers','items','leads','deals','contacts','expenses','payments']));

create or replace function public.wf_update_fields(p_module text) returns text[] language sql immutable as $$
  select case p_module
    when 'invoices' then array['reference', 'subject', 'terms', 'allow_online_payment']
    when 'quotes' then array['reference', 'subject']
    when 'sales_orders' then array['reference', 'delivery_method', 'expected_shipment_date']
    when 'bills' then array['reference', 'subject', 'notes', 'expected_payment_date']
    when 'customers' then array['notes', 'reminders_stopped', 'credit_limit', 'credit_days', 'salesperson_id', 'account_type', 'industry']
    when 'items' then array['reorder_level', 'is_active', 'category']
    when 'leads' then array['priority', 'probability', 'description', 'lead_status', 'rating', 'salesperson_id']
    when 'deals' then array['stage', 'probability', 'next_step', 'closing_date', 'owner_id', 'deal_type', 'description']
    when 'contacts' then array['owner_id', 'lead_source', 'description', 'email_opt_out']
    when 'expenses' then array['reference', 'description', 'notes']
    when 'payments' then array['reference', 'notes']
    else array[]::text[] end
$$;

create or replace function public.wf_set_field(p_rule uuid, p_record uuid, p_field text, p_value text, p_chain uuid[] default '{}'::uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare r public.workflow_rules; v_table text; v_type text; v_n int;
begin
  select * into r from public.workflow_rules where id = p_rule;
  if r.id is null then raise exception 'Rule not found'; end if;
  if not (p_field = any(public.wf_update_fields(r.module))) then raise exception 'A rule cannot change %', p_field; end if;
  v_table := case r.module when 'items' then 'products' when 'leads' then 'crm_leads' when 'deals' then 'crm_deals' when 'contacts' then 'crm_contacts' when 'payments' then 'payments_received' else r.module end;
  select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a where a.attrelid = ('public.' || v_table)::regclass and a.attname = p_field and a.attnum > 0 and not a.attisdropped;
  if v_type is null then raise exception 'Unknown field %', p_field; end if;
  perform set_config('dash.wf_chain', (coalesce(p_chain, '{}') || p_rule)::text, true);
  execute format('update public.%I set %I = %s where id = $1 and tenant_id = $2', v_table, p_field,
    case when p_value is null or btrim(p_value) = '' then 'null' else format('%L::%s', btrim(p_value), v_type) end)
    using p_record, r.tenant_id;
  get diagnostics v_n = row_count;
  perform set_config('dash.wf_chain', '', true);
  return v_n;
end $$;

drop trigger if exists wf_enqueue on public.crm_deals;
create trigger wf_enqueue after insert or update on public.crm_deals for each row execute function public.wf_enqueue('deals');
drop trigger if exists wf_enqueue on public.crm_contacts;
create trigger wf_enqueue after insert or update on public.crm_contacts for each row execute function public.wf_enqueue('contacts');

-- Round-robin assignment: the next person in a rule's list gets the record.
create table if not exists public.crm_round_robin (
  key text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  last_index integer not null default -1,
  updated_at timestamptz not null default now()
);
alter table public.crm_round_robin enable row level security;
revoke all on public.crm_round_robin from anon, authenticated;

create or replace function public.crm_next_assignee(p_tenant uuid, p_key text, p_users uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare _i int;
begin
  if coalesce(array_length(p_users, 1), 0) = 0 then return null; end if;
  insert into public.crm_round_robin (key, tenant_id, last_index) values (p_key, p_tenant, 0)
  on conflict (key) do update set last_index = (crm_round_robin.last_index + 1) % array_length(p_users, 1), updated_at = now()
  returning last_index into _i;
  return p_users[(_i % array_length(p_users, 1)) + 1];
end $$;
revoke all on function public.crm_next_assignee(uuid, text, uuid[]) from public, anon, authenticated;

-- Website lead forms: a form key on any website posts leads into the CRM.
create table if not exists public.crm_web_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  form_key text not null unique default replace(gen_random_uuid()::text, '-', ''),
  fields text[] not null default array['first_name','last_name','email','phone','partner_name','description'],
  lead_source text not null default 'Website',
  owner_ids uuid[] not null default '{}',
  thank_you text not null default 'Thank you. We will get back to you shortly.',
  redirect_url text,
  active boolean not null default true,
  submissions integer not null default 0,
  last_submitted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.crm_web_forms enable row level security;
drop policy if exists crm_web_forms_tenant on public.crm_web_forms;
create policy crm_web_forms_tenant on public.crm_web_forms for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.crm_web_forms to authenticated;

-- Live updates on the CRM screens.
do $$
declare t text;
begin
  foreach t in array array['crm_contacts', 'crm_notes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

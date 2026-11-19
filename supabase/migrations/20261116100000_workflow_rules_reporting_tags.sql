-- Workflow rules and reporting tags. Re-runnable.
--
-- 1. Workflow rules (System → Workflow rules): a rule watches one module (invoices, quotes,
--    sales orders, bills, customers, items, leads/deals, expenses, payments received) and runs
--    actions (email, SMS, bell, change a field, webhook) when a record is created, changed, a
--    field changes to a value, or N days before/after a date. Triggers queue record events in
--    workflow_queue; the server (workflows.js) evaluates the rules and runs the actions, logging
--    each run once in workflow_runs (unique per rule, record and slot). Date rules run once a day
--    per company (workflow_daily). At most 50 rules per company. A field changed by a rule carries
--    the rule chain (dash.wf_chain) so it never retriggers the same rule.
-- 2. Reporting tags: tags with values (e.g. Region: Nairobi / Mombasa), optional or mandatory per
--    module, stored as jsonb `tags` ({tag_id: value}) on invoices, bills, expenses, credit notes
--    and journals. acc_tag_balances() gives the profit and loss filtered or grouped by a tag.

-- ═══════════════════════════════════════════════════════════════════ workflow rules
create table if not exists public.workflow_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  module text not null check (module in ('invoices', 'quotes', 'sales_orders', 'bills', 'customers', 'items', 'leads', 'expenses', 'payments')),
  trigger_type text not null default 'created' check (trigger_type in ('created', 'updated', 'field_changed', 'date')),
  trigger_field text check (trigger_field is null or trigger_field ~ '^[a-z_][a-z0-9_]{0,62}$'),
  trigger_value text,
  date_field text check (date_field is null or date_field ~ '^[a-z_][a-z0-9_]{0,62}$'),
  date_offset int not null default 0 check (date_offset between -365 and 365),
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 10),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 10),
  is_active boolean not null default true,
  run_count int not null default 0,
  last_run_at timestamptz,
  last_status text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trigger_type <> 'field_changed' or trigger_field is not null),
  check (trigger_type <> 'date' or date_field is not null)
);
create index if not exists workflow_rules_tenant_idx on public.workflow_rules (tenant_id, module) where is_active;
alter table public.workflow_rules enable row level security;
drop policy if exists workflow_rules_managers on public.workflow_rules;
create policy workflow_rules_managers on public.workflow_rules for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.can_manage_shop())
  with check (tenant_id = public.current_user_tenant_id() and public.can_manage_shop());
revoke all on public.workflow_rules from anon;
grant select, insert, update, delete on public.workflow_rules to authenticated;

/** At most 50 rules per company. */
create or replace function public.wf_rules_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('workflow_rules:' || NEW.tenant_id::text));
  if (select count(*) from public.workflow_rules where tenant_id = NEW.tenant_id) >= 50 then
    raise exception 'A company can have up to 50 workflow rules. Delete one you no longer use first.';
  end if;
  return NEW;
end $$;
revoke all on function public.wf_rules_limit() from public, anon, authenticated;
drop trigger if exists wf_rules_limit on public.workflow_rules;
create trigger wf_rules_limit before insert on public.workflow_rules for each row execute function public.wf_rules_limit();

do $$ begin
  if exists (select 1 from pg_proc where proname = 'cc_tenant_fixed' and pronamespace = 'public'::regnamespace) then
    drop trigger if exists workflow_rules_tenant_fixed on public.workflow_rules;
    create trigger workflow_rules_tenant_fixed before update of tenant_id on public.workflow_rules for each row execute function public.cc_tenant_fixed();
  end if;
end $$;

/** Record events waiting for the rules (server only). */
create table if not exists public.workflow_queue (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module text not null,
  record_id uuid not null,
  op text not null check (op in ('INSERT', 'UPDATE')),
  changed text[] not null default '{}',
  row_data jsonb not null,
  chain uuid[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'done', 'failed')),
  attempts int not null default 0,
  detail text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists workflow_queue_new_idx on public.workflow_queue (id) where status = 'new';
create index if not exists workflow_queue_done_idx on public.workflow_queue (done_at) where status <> 'new';
alter table public.workflow_queue enable row level security;
revoke all on public.workflow_queue from anon, authenticated;

/** One line per rule run on a record; the unique slot stops a run happening twice. */
create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid not null references public.workflow_rules(id) on delete cascade,
  record_id uuid not null,
  record_label text,
  slot text not null,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed', 'skipped')),
  results jsonb not null default '[]'::jsonb,
  detail text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (rule_id, record_id, slot)
);
create index if not exists workflow_runs_rule_idx on public.workflow_runs (rule_id, created_at desc);
create index if not exists workflow_runs_tenant_idx on public.workflow_runs (tenant_id, created_at desc);
alter table public.workflow_runs enable row level security;
drop policy if exists workflow_runs_read on public.workflow_runs;
create policy workflow_runs_read on public.workflow_runs for select to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.can_manage_shop());
revoke all on public.workflow_runs from anon, authenticated;
grant select on public.workflow_runs to authenticated;

/** The daily pass of date rules, claimed once per company per day (server only). */
create table if not exists public.workflow_daily (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_date date not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, run_date)
);
alter table public.workflow_daily enable row level security;
revoke all on public.workflow_daily from anon, authenticated;

/** Queues a record event when the company has an active event rule for the module. Never blocks the change. */
create or replace function public.wf_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_module text := TG_ARGV[0];
  v_new jsonb;
  v_old jsonb;
  v_changed text[] := '{}';
  v_chain uuid[] := '{}';
  v_raw text;
begin
  if NEW.tenant_id is null then return NEW; end if;
  if not exists (select 1 from public.workflow_rules r where r.tenant_id = NEW.tenant_id and r.module = v_module and r.is_active and r.trigger_type <> 'date') then
    return NEW;
  end if;
  v_new := to_jsonb(NEW);
  if TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    select coalesce(array_agg(k order by k), '{}') into v_changed
      from jsonb_object_keys(v_new) as k
     where k <> 'updated_at' and (v_new -> k) is distinct from (v_old -> k);
    if cardinality(v_changed) = 0 then return NEW; end if;
  end if;
  v_raw := nullif(current_setting('dash.wf_chain', true), '');
  if v_raw is not null then v_chain := v_raw::uuid[]; end if;
  insert into public.workflow_queue (tenant_id, module, record_id, op, changed, row_data, chain)
  values (NEW.tenant_id, v_module, NEW.id, TG_OP, v_changed, v_new, v_chain);
  return NEW;
exception when others then
  raise warning 'workflow queue (% %): %', TG_TABLE_NAME, TG_OP, sqlerrm;
  return NEW;
end $$;
revoke all on function public.wf_enqueue() from public, anon, authenticated;

do $$
declare m text; t text;
begin
  for m, t in select * from (values ('invoices', 'invoices'), ('quotes', 'quotes'), ('sales_orders', 'sales_orders'), ('bills', 'bills'),
                                    ('customers', 'customers'), ('items', 'products'), ('leads', 'crm_leads'), ('expenses', 'expenses'),
                                    ('payments', 'payments_received')) v(m, t) loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists wf_enqueue on public.%I', t);
    execute format('create trigger wf_enqueue after insert or update on public.%I for each row execute function public.wf_enqueue(%L)', t, m);
  end loop;
end $$;

/** Fields a rule may change, per module (the screen offers the same list). */
create or replace function public.wf_update_fields(p_module text) returns text[]
language sql immutable as $$
  select case p_module
    when 'invoices' then array['reference', 'subject', 'terms', 'allow_online_payment']
    when 'quotes' then array['reference', 'subject']
    when 'sales_orders' then array['reference', 'delivery_method', 'expected_shipment_date']
    when 'bills' then array['reference', 'subject', 'notes', 'expected_payment_date']
    when 'customers' then array['notes', 'reminders_stopped', 'credit_limit', 'credit_days']
    when 'items' then array['reorder_level', 'is_active', 'category']
    when 'leads' then array['priority', 'probability', 'description']
    when 'expenses' then array['reference', 'description', 'notes']
    when 'payments' then array['reference', 'notes']
    else array[]::text[] end
$$;
revoke all on function public.wf_update_fields(text) from public, anon;
grant execute on function public.wf_update_fields(text) to authenticated, service_role;

/**
 * Changes one field of a record for a rule (server only). Only the whitelisted fields; the rule
 * chain goes with the change so the record event it causes never runs the same rule again.
 */
create or replace function public.wf_set_field(p_rule uuid, p_record uuid, p_field text, p_value text, p_chain uuid[] default '{}')
returns int language plpgsql security definer set search_path = public as $$
declare r public.workflow_rules; v_table text; v_type text; v_n int;
begin
  select * into r from public.workflow_rules where id = p_rule;
  if r.id is null then raise exception 'Rule not found'; end if;
  if not (p_field = any(public.wf_update_fields(r.module))) then raise exception 'A rule cannot change %', p_field; end if;
  v_table := case r.module when 'items' then 'products' when 'leads' then 'crm_leads' when 'payments' then 'payments_received' else r.module end;
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
revoke all on function public.wf_set_field(uuid, uuid, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.wf_set_field(uuid, uuid, text, text, uuid[]) to service_role;

/** Counts a finished run on its rule (server only). */
create or replace function public.wf_rule_ran(p_rule uuid, p_status text)
returns void language sql security definer set search_path = public as $$
  update public.workflow_rules set run_count = run_count + 1, last_run_at = now(), last_status = left(p_status, 20) where id = p_rule
$$;
revoke all on function public.wf_rule_ran(uuid, text) from public, anon, authenticated;
grant execute on function public.wf_rule_ran(uuid, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════ reporting tags
create table if not exists public.reporting_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  options text[] not null default '{}',
  -- {"invoices": "optional" | "mandatory", "bills": ..., "expenses": ..., "journals": ..., "credit_notes": ...}; missing = not shown
  modules jsonb not null default '{}'::jsonb check (jsonb_typeof(modules) = 'object'),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table public.reporting_tags enable row level security;
drop policy if exists reporting_tags_read on public.reporting_tags;
create policy reporting_tags_read on public.reporting_tags for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
drop policy if exists reporting_tags_write on public.reporting_tags;
create policy reporting_tags_write on public.reporting_tags for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.can_manage_shop())
  with check (tenant_id = public.current_user_tenant_id() and public.can_manage_shop());
revoke all on public.reporting_tags from anon;
grant select, insert, update, delete on public.reporting_tags to authenticated;

do $$
declare t text;
begin
  foreach t in array array['invoices', 'bills', 'expenses', 'credit_notes', 'journals'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists tags jsonb not null default %L::jsonb', t, '{}');
    execute format('create index if not exists %I on public.%I using gin (tags jsonb_path_ops)', t || '_tags_idx', t);
  end loop;
end $$;

/** Tags on a manual journal (journals are rewritten on every post, so the screen sets them after posting). */
create or replace function public.acc_set_journal_tags(p_source_id uuid, p_tags jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_shop() then raise exception 'Only administrators and managers can change journals'; end if;
  if p_tags is not null and jsonb_typeof(p_tags) <> 'object' then raise exception 'Tags must be an object'; end if;
  update public.journals set tags = coalesce(p_tags, '{}'::jsonb)
   where tenant_id = public.current_user_tenant_id() and source_type = 'manual' and source_id = p_source_id;
end $$;
revoke all on function public.acc_set_journal_tags(uuid, jsonb) from public, anon;
grant execute on function public.acc_set_journal_tags(uuid, jsonb) to authenticated;

/**
 * Income and expense movement per account and tag value for the profit and loss.
 * The tag of a journal is the one on its document (invoice, bill, expense, credit note) or,
 * for manual journals, on the journal. p_value null: every value (grouped, untagged = null);
 * p_value '': only untagged; otherwise only that value.
 */
create or replace function public.acc_tag_balances(p_from date, p_to date, p_tag uuid, p_value text default null)
returns table (account_id uuid, code text, name text, type text, sub_type text, tag_value text, debit numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  with jt as (
    select j.id,
      nullif(coalesce(case j.source_type
        when 'invoice' then (select i.tags from public.invoices i where i.id = j.source_id)
        when 'bill' then (select b.tags from public.bills b where b.id = j.source_id)
        when 'expense' then (select e.tags from public.expenses e where e.id = j.source_id)
        when 'credit_note' then (select c.tags from public.credit_notes c where c.id = j.source_id)
        else j.tags end, '{}'::jsonb) ->> p_tag::text, '') as v
    from public.journals j
    where j.tenant_id = public.current_user_tenant_id() and j.journal_date between p_from and p_to
  )
  select a.id, a.code, a.name, a.type, a.sub_type, jt.v, coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
  from jt
  join public.journal_lines l on l.journal_id = jt.id
  join public.chart_of_accounts a on a.id = l.account_id
  where a.type in ('income', 'expense')
    and case when p_value is null then true when p_value = '' then jt.v is null else jt.v = p_value end
  group by a.id, a.code, a.name, a.type, a.sub_type, jt.v
  order by a.code nulls last, a.name
$$;
revoke all on function public.acc_tag_balances(date, date, uuid, text) from public, anon;
grant execute on function public.acc_tag_balances(date, date, uuid, text) to authenticated;

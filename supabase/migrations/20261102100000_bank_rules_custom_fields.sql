-- Bank rules: statement lines whose text matches a rule are categorised (or excluded) with one click, or by themselves.
-- Custom fields: a company adds its own fields to customers, suppliers, items and documents.

create table if not exists public.bank_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  contains text not null check (length(trim(contains)) > 0),
  direction text not null default 'any' check (direction in ('any', 'in', 'out')),
  min_amount numeric(16,2),
  max_amount numeric(16,2),
  bank_account_id uuid references public.chart_of_accounts(id) on delete cascade, -- null: every bank account
  action text not null default 'categorize' check (action in ('categorize', 'exclude')),
  account_id uuid references public.chart_of_accounts(id) on delete cascade,
  auto_apply boolean not null default false,
  is_active boolean not null default true,
  times_used int not null default 0,
  created_at timestamptz not null default now(),
  check (action = 'exclude' or account_id is not null)
);
create index if not exists bank_rules_tenant_idx on public.bank_rules (tenant_id) where is_active;

alter table public.bank_rules enable row level security;
drop policy if exists bank_rules_select on public.bank_rules;
create policy bank_rules_select on public.bank_rules for select using (tenant_id = public.current_user_tenant_id());
drop policy if exists bank_rules_write on public.bank_rules;
create policy bank_rules_write on public.bank_rules for all
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
grant select, insert, update, delete on public.bank_rules to authenticated;

-- Which rule fits each line still to categorise. The longest matching text wins; then the oldest rule.
create or replace function public.bank_rule_matches(p_bank uuid default null)
returns table (line_id uuid, rule_id uuid, rule_name text, action text, account_id uuid, auto_apply boolean)
language sql stable security definer set search_path = public as $$
  select b.id, r.id, r.name, r.action, r.account_id, r.auto_apply
  from public.bank_transactions b
  cross join lateral (
    select x.* from public.bank_rules x
    where x.tenant_id = b.tenant_id and x.is_active
      and (x.bank_account_id is null or x.bank_account_id = b.account_id)
      and position(lower(trim(x.contains)) in lower(concat_ws(' ', b.description, b.payee, b.reference))) > 0
      and (x.direction = 'any' or (x.direction = 'in' and b.amount > 0) or (x.direction = 'out' and b.amount < 0))
      and (x.min_amount is null or abs(b.amount) >= x.min_amount)
      and (x.max_amount is null or abs(b.amount) <= x.max_amount)
      and (x.action = 'exclude' or (x.account_id is distinct from b.account_id
        and exists (select 1 from public.chart_of_accounts a where a.id = x.account_id and a.tenant_id = b.tenant_id)))
    order by length(trim(x.contains)) desc, x.created_at
    limit 1
  ) r
  where b.tenant_id = public.current_user_tenant_id() and b.status = 'uncategorized'
    and (p_bank is null or b.account_id = p_bank)
$$;
revoke all on function public.bank_rule_matches(uuid) from public, anon;
grant execute on function public.bank_rule_matches(uuid) to authenticated;

-- Posts the lines the rules fit. A line that cannot post (a locked period, say) stays to categorise by hand.
create or replace function public.bank_rules_apply(p_bank uuid default null, p_auto_only boolean default false, p_line uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; v_done int := 0; v_skipped int := 0;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then
    raise exception 'Only an admin or manager can apply bank rules';
  end if;
  for m in select * from public.bank_rule_matches(p_bank) where (not p_auto_only or auto_apply) and (p_line is null or line_id = p_line) loop
    begin
      perform public.acc_categorize_bank_line(m.line_id, m.account_id, m.action = 'exclude');
      update public.bank_rules set times_used = times_used + 1 where id = m.rule_id;
      v_done := v_done + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  return jsonb_build_object('applied', v_done, 'skipped', v_skipped);
end $$;
revoke all on function public.bank_rules_apply(uuid, boolean, uuid) from public, anon;
grant execute on function public.bank_rules_apply(uuid, boolean, uuid) to authenticated;

create table if not exists public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  entity text not null check (entity in ('customer', 'supplier', 'item', 'quote', 'sales_order', 'invoice', 'purchase_order', 'bill')),
  label text not null check (length(trim(label)) > 0),
  field_type text not null default 'text' check (field_type in ('text', 'number', 'date', 'dropdown', 'checkbox')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  show_on_pdf boolean not null default false,
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists custom_fields_tenant_idx on public.custom_fields (tenant_id, entity, sort);

alter table public.custom_fields enable row level security;
drop policy if exists custom_fields_select on public.custom_fields;
create policy custom_fields_select on public.custom_fields for select using (tenant_id = public.current_user_tenant_id());
drop policy if exists custom_fields_write on public.custom_fields;
create policy custom_fields_write on public.custom_fields for all
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
grant select, insert, update, delete on public.custom_fields to authenticated;

-- The values live on the record itself, keyed by the field's id, so renaming a field keeps them.
do $$
declare t text;
begin
  foreach t in array array['customers', 'suppliers', 'products', 'services', 'quotes', 'sales_orders', 'invoices', 'purchases', 'bills'] loop
    execute format('alter table public.%I add column if not exists custom jsonb not null default ''{}''::jsonb', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

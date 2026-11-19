-- KRA eTIMS device serial numbers in the series JMSURF TAX registered with KRA
-- (JMSDASH0001, JMSDASH0002 …). Each company branch gets the next number once
-- and keeps it. JMSDASH0001 is JMSURF's own.

create table if not exists public.etims_serials (
  serial text primary key,
  seq int not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id text not null default '00',
  issued_by uuid default auth.uid(),
  issued_at timestamptz not null default now(),
  unique (tenant_id, branch_id)
);
alter table public.etims_serials enable row level security;
drop policy if exists etims_serials_read on public.etims_serials;
create policy etims_serials_read on public.etims_serials for select to authenticated using (tenant_id = public.current_user_tenant_id());
grant select on public.etims_serials to authenticated;

/** The company branch's device serial number: the one already issued, or the next in the series. */
create or replace function public.issue_etims_serial(p_branch text default '00')
returns text language plpgsql security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); b text; s text; n int;
begin
  if t is null then raise exception 'No company for this account'; end if;
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then raise exception 'Only admins and managers can set up KRA eTIMS'; end if;
  b := lpad(coalesce(nullif(regexp_replace(coalesce(p_branch, '00'), '\D', '', 'g'), ''), '00'), 2, '0');
  select serial into s from public.etims_serials where tenant_id = t and branch_id = b;
  if s is not null then return s; end if;
  lock table public.etims_serials in exclusive mode;
  select greatest(coalesce(max(seq), 1), 1) + 1 into n from public.etims_serials;
  s := 'JMSDASH' || lpad(n::text, 4, '0');
  insert into public.etims_serials (serial, seq, tenant_id, branch_id) values (s, n, t, b);
  return s;
end $$;
grant execute on function public.issue_etims_serial(text) to authenticated;

-- Modules a company hid from the menu (still paid and on): every staff member's sidebar follows it.
do $$
declare d text := pg_get_viewdef('public.business_settings_safe'::regclass);
begin
  if d !~ 'modules_hidden' then
    d := regexp_replace(d, 'AS signing_rules\s+FROM \(business_settings bs', 'AS signing_rules, (bs.erp_settings -> ''modules_hidden''::text) AS modules_hidden FROM (business_settings bs');
    execute 'create or replace view public.business_settings_safe with (security_barrier = true) as ' || rtrim(d, '; ');
  end if;
end $$;

-- Menu items a company hid (System → Menu items).
do $$
declare d text := pg_get_viewdef('public.business_settings_safe'::regclass);
begin
  if d !~ 'menu_hidden' then
    d := regexp_replace(d, 'AS modules_hidden\s+FROM \(business_settings bs', 'AS modules_hidden, (bs.erp_settings -> ''menu_hidden''::text) AS menu_hidden FROM (business_settings bs');
    execute 'create or replace view public.business_settings_safe with (security_barrier = true) as ' || rtrim(d, '; ');
  end if;
end $$;

-- Admin → Companies: everything the platform owner does for one company, on its page.
--  * platform_admin_actions gets tenant_id: every admin action on a company shows in its
--    Activity tab (the app server writes them; browser edits are caught by the trigger below).
--  * platform_tenant_notes: the owner's private notes on a company (written by the app server).
--  * subscriptions.comped_until / comp_note: the whole plan free until a date.
--  * tenant_modules: a free (comped) module can end on a date (current_period_end).
--  * admin_add_sms_units takes a note; still platform owner only.

-- ── Audit: which company an admin action was about ─────────────────────────
alter table public.platform_admin_actions add column if not exists tenant_id uuid references public.tenants(id) on delete set null;
create index if not exists platform_admin_actions_tenant_idx on public.platform_admin_actions (tenant_id, created_at desc);

-- ── Admin notes on a company ───────────────────────────────────────────────
create table if not exists public.platform_tenant_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  author_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists platform_tenant_notes_tenant_idx on public.platform_tenant_notes (tenant_id, created_at desc);
alter table public.platform_tenant_notes enable row level security;
drop policy if exists platform_tenant_notes_read on public.platform_tenant_notes;
create policy platform_tenant_notes_read on public.platform_tenant_notes for select to authenticated using (public.is_platform_admin());
revoke insert, update, delete on public.platform_tenant_notes from anon, authenticated;

-- ── Whole plan free until a date ───────────────────────────────────────────
alter table public.subscriptions add column if not exists comped_until timestamptz;
alter table public.subscriptions add column if not exists comp_note text;

-- ── A free module can end on a date (current_period_end); otherwise as before ──
create or replace function public.tenant_module_active(p_tenant uuid, p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  with k as (select public.module_of(p_key) as key)
  select
    coalesce((select included from public.platform_modules, k where platform_modules.key = k.key), false)
    or exists (
      select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id, k
      where s.tenant_id = p_tenant and ((p.all_modules and k.key <> 'callcentre') or k.key = any (p.included_modules))
    )
    or exists (
      select 1 from public.tenant_modules m, k
      where m.tenant_id = p_tenant and m.module_key = k.key
        and ((m.status = 'comped' and (m.current_period_end is null or m.current_period_end > now()))
          or (m.status = 'trial' and coalesce(m.trial_ends_at, now()) > now())
          or (m.status in ('active', 'past_due') and coalesce(m.current_period_end, now() + interval '1 day') > now() - interval '3 days')
          or (m.status = 'cancelled' and m.current_period_end is not null and m.current_period_end > now()))
    )
$function$;
revoke all on function public.tenant_module_active(uuid, text) from public, anon;
grant execute on function public.tenant_module_active(uuid, text) to authenticated, service_role;

-- ── SMS credit with a note (platform owner only, as before) ────────────────
drop function if exists public.admin_add_sms_units(uuid, integer, numeric, text);
create or replace function public.admin_add_sms_units(p_tenant uuid, p_units integer, p_amount numeric default 0, p_reference text default null, p_note text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare _bal integer; _price numeric;
begin
  if not public.has_role(auth.uid(), 'super_admin') then raise exception 'Only the platform owner can add SMS units'; end if;
  if coalesce(p_units, 0) = 0 then raise exception 'Enter the number of SMS'; end if;
  if abs(p_units) > 1000000 then raise exception 'That is too many SMS at once'; end if;
  insert into public.tenant_sms_settings (tenant_id, is_active, balance_units)
  values (p_tenant, true, greatest(0, p_units))
  on conflict (tenant_id) do update set balance_units = greatest(0, tenant_sms_settings.balance_units + p_units), is_active = true, updated_at = now()
  returning balance_units, price_per_sms into _bal, _price;
  insert into public.tenant_sms_topups (tenant_id, units_added, amount_paid, price_per_sms, reference, notes, recorded_by)
  values (p_tenant, p_units, coalesce(p_amount, 0), coalesce(_price, 0), coalesce(p_reference, ''), left(coalesce(p_note, ''), 500), auth.uid());
  return _bal;
end $$;
revoke all on function public.admin_add_sms_units(uuid, integer, numeric, text, text) from public, anon;
grant execute on function public.admin_add_sms_units(uuid, integer, numeric, text, text) to authenticated;

-- ── Edits made from the admin console in the browser are recorded too ──────
-- (The app server writes its own entries with the service key; auth.uid() is empty there, so nothing is doubled.)
create or replace function public.platform_admin_audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare _new jsonb; _old jsonb; _diff jsonb := '{}'::jsonb; _k text; _tenant uuid;
begin
  if auth.uid() is null or not public.platform_context()
     or not exists (select 1 from public.platform_admins where user_id = auth.uid()) then
    return coalesce(new, old);
  end if;
  _new := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  _old := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  for _k in select jsonb_object_keys(_new || _old) loop
    if _k not in ('updated_at', 'created_at') and (_new -> _k) is distinct from (_old -> _k) then
      _diff := _diff || jsonb_build_object(_k, jsonb_build_array(_old -> _k, _new -> _k));
    end if;
  end loop;
  if _diff = '{}'::jsonb then return coalesce(new, old); end if;
  _tenant := case when tg_table_name = 'tenants' then coalesce((_new ->> 'id'), (_old ->> 'id'))::uuid
                  else coalesce((_new ->> 'tenant_id'), (_old ->> 'tenant_id'))::uuid end;
  insert into public.platform_admin_actions (admin_id, action, target_type, target_id, tenant_id, detail)
  values (auth.uid(), tg_table_name || '_' || lower(tg_op), tg_table_name, coalesce((_new ->> 'id'), (_old ->> 'id'))::uuid,
          _tenant, jsonb_build_object('changed', _diff));
  return coalesce(new, old);
end $$;
revoke all on function public.platform_admin_audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['tenants', 'subscriptions', 'tenant_modules', 'tenant_feature_overrides'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists platform_admin_audit on public.%I', t);
      execute format('create trigger platform_admin_audit after insert or update or delete on public.%I for each row execute function public.platform_admin_audit_row()', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

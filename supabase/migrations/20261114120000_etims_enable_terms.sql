-- KRA eTIMS is off until a company enables it: an admin presses Enable and accepts the terms, and only then
-- is a device serial issued by JMSURF TAX. Opening the eTIMS page no longer gives a company a serial.

-- Enable: records who accepted the terms and when, and issues the serial for the branch (same numbering as before).
create or replace function public.enable_etims(p_branch text default '00', p_terms_version text default '2026-11')
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare t uuid := public.current_user_tenant_id(); b text; s text; n int;
begin
  if t is null then raise exception 'No company for this account'; end if;
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Only an admin can enable KRA eTIMS'; end if;
  b := lpad(coalesce(nullif(regexp_replace(coalesce(p_branch, '00'), '\D', '', 'g'), ''), '00'), 2, '0');
  update public.business_settings
     set erp_settings = coalesce(erp_settings, '{}'::jsonb) || jsonb_build_object('etims',
           coalesce(erp_settings->'etims', '{}'::jsonb) || jsonb_build_object(
             'enabled', true, 'enabled_at', now(), 'terms_accepted_at', now(), 'terms_accepted_by', auth.uid(), 'terms_version', p_terms_version))
   where tenant_id = t;
  select serial into s from public.etims_serials where tenant_id = t and branch_id = b;
  if s is not null then return s; end if;
  lock table public.etims_serials in exclusive mode;
  select coalesce(max(seq), 0) + 1 into n from public.etims_serials;
  s := 'JMSURFTAX' || case when n < 1000 then lpad(n::text, 3, '0') else n::text end;
  insert into public.etims_serials (serial, seq, tenant_id, branch_id) values (s, n, t, b);
  return s;
end $$;
revoke all on function public.enable_etims(text, text) from public, anon;
grant execute on function public.enable_etims(text, text) to authenticated;

-- A serial for another branch: only once eTIMS is enabled (terms accepted). Companies already connected keep working.
create or replace function public.issue_etims_serial(p_branch text default '00')
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare t uuid := public.current_user_tenant_id(); b text; s text; n int; e jsonb;
begin
  if t is null then raise exception 'No company for this account'; end if;
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then raise exception 'Only admins and managers can set up KRA eTIMS'; end if;
  select erp_settings->'etims' into e from public.business_settings where tenant_id = t;
  if not (coalesce((e->>'enabled')::boolean, false) or e ? 'initialised_at' or coalesce(e->>'device_serial', '') <> '') then
    raise exception 'Enable KRA eTIMS and accept the terms first';
  end if;
  b := lpad(coalesce(nullif(regexp_replace(coalesce(p_branch, '00'), '\D', '', 'g'), ''), '00'), 2, '0');
  select serial into s from public.etims_serials where tenant_id = t and branch_id = b;
  if s is not null then return s; end if;
  lock table public.etims_serials in exclusive mode;
  select coalesce(max(seq), 0) + 1 into n from public.etims_serials;
  s := 'JMSURFTAX' || case when n < 1000 then lpad(n::text, 3, '0') else n::text end;
  insert into public.etims_serials (serial, seq, tenant_id, branch_id) values (s, n, t, b);
  return s;
end $$;
grant execute on function public.issue_etims_serial(text) to authenticated;

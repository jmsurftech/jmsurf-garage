-- Device serial numbers in the series KRA uses for JMSURF TAX: JMSURFTAX001, JMSURFTAX002 …
-- (three digits, growing past 999 without cutting digits). One per company branch, kept for good.
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
  select coalesce(max(seq), 0) + 1 into n from public.etims_serials;
  s := 'JMSURFTAX' || case when n < 1000 then lpad(n::text, 3, '0') else n::text end;
  insert into public.etims_serials (serial, seq, tenant_id, branch_id) values (s, n, t, b);
  return s;
end $$;
grant execute on function public.issue_etims_serial(text) to authenticated;

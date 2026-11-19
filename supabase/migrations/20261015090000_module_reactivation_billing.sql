-- Switching a module back on after its free trial ended (or after cancelling it) no longer makes it
-- active for free until the next renewal. Still inside a paid period: back on at no charge. Otherwise
-- it is "payment due": 3 days' grace (tenant_module_active), it is on the next bill, and it stops if unpaid.
create or replace function public.activate_module(p_key text)
returns public.tenant_modules
language plpgsql security definer set search_path to 'public' as $function$
declare
  _tenant uuid := public.current_user_tenant_id();
  _mod public.platform_modules;
  _row public.tenant_modules;
begin
  if _tenant is null then raise exception 'No company selected'; end if;
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Only the company administrator can change modules';
  end if;
  select * into _mod from public.platform_modules where key = p_key and is_active;
  if _mod.key is null then raise exception 'Unknown module'; end if;
  if _mod.included then raise exception 'This module is already part of JMSURF BOOKS'; end if;

  select * into _row from public.tenant_modules where tenant_id = _tenant and module_key = p_key;
  if _row.id is null then
    insert into public.tenant_modules (tenant_id, module_key, status, price_monthly, trial_ends_at, activated_by)
    values (_tenant, p_key, 'trial', _mod.price_monthly, now() + interval '14 days', auth.uid())
    returning * into _row;
  elsif _row.status = 'cancelled' and _row.current_period_end is not null and _row.current_period_end > now() then
    -- Paid until a date still ahead: back on, nothing to pay yet.
    update public.tenant_modules
       set status = 'active', cancelled_at = null, activated_by = auth.uid(), activated_at = now(), updated_at = now()
     where id = _row.id returning * into _row;
  elsif _row.status = 'cancelled' or (_row.status = 'trial' and _row.trial_ends_at <= now()) then
    update public.tenant_modules
       set status = 'past_due', price_monthly = _mod.price_monthly, cancelled_at = null,
           current_period_end = now(), activated_by = auth.uid(), activated_at = now(), updated_at = now()
     where id = _row.id returning * into _row;
  end if;
  perform public.record_tenant_activity(_tenant, auth.uid(), null, null, 'module_activated', 'module', p_key,
    case when _row.status = 'past_due' then 'Switched on ' || _mod.name || ' (payment due)' else 'Switched on ' || _mod.name end, '{}'::jsonb);
  return _row;
end $function$;

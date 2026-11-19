-- JMSURF CALL CENTRE: what callers hear while they wait, and the call centre is billed on its own
-- (DASH's all-modules plan no longer includes it; companies keep it through tenant_modules).
alter table public.cc_settings
  add column if not exists record_notice boolean not null default true,
  add column if not exists wait_message text;
grant select (record_notice, wait_message, hold_music_url) on public.cc_settings to authenticated;

create or replace function public.tenant_module_active(p_tenant uuid, p_key text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
        and (m.status = 'comped'
          or (m.status = 'trial' and coalesce(m.trial_ends_at, now()) > now())
          or (m.status in ('active', 'past_due') and coalesce(m.current_period_end, now() + interval '1 day') > now() - interval '3 days'))
    )
$function$;

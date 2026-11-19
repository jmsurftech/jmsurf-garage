-- JMSURF CALL CENTRE: SautiKit as a second voice provider (primary from 2026-10-10).
--   * every pool number says which provider it lives on, and its id there
--   * calls remember the provider and the provider's call id
--   * a short log of raw provider callbacks, for checking new integrations
--   * cc_take_number prefers numbers of the primary provider

alter table public.cc_numbers add column if not exists provider text not null default 'africastalking';
alter table public.cc_numbers add column if not exists provider_ref text;
alter table public.cc_numbers drop constraint if exists cc_numbers_provider_check;
alter table public.cc_numbers add constraint cc_numbers_provider_check check (provider in ('africastalking', 'sautikit'));
create unique index if not exists cc_numbers_provider_ref on public.cc_numbers (provider, provider_ref) where provider_ref is not null;

alter table public.cc_calls add column if not exists provider text;
alter table public.cc_calls add column if not exists provider_call_id text;
create index if not exists cc_calls_provider_call on public.cc_calls (provider_call_id) where provider_call_id is not null;

create table if not exists public.cc_provider_log (
  id bigint generated always as identity primary key,
  provider text not null,
  kind text not null,
  query text,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists cc_provider_log_time on public.cc_provider_log (created_at desc);
alter table public.cc_provider_log enable row level security;
revoke all on public.cc_provider_log from anon, authenticated;
grant all on public.cc_provider_log to service_role;

drop function if exists public.cc_take_number(uuid, text);
create or replace function public.cc_take_number(p_tenant uuid, p_kind text default null, p_provider text default null)
returns public.cc_numbers language plpgsql security definer set search_path = public as $$
declare n public.cc_numbers;
begin
  select * into n from public.cc_numbers where tenant_id = p_tenant and status = 'assigned' limit 1;
  if n.id is not null then return n; end if;
  -- Best match first: the primary provider and the kind asked for, then either one, then anything free.
  select * into n from public.cc_numbers where status = 'available'
   order by (p_provider is not null and provider = p_provider) desc, (p_kind is not null and kind = p_kind) desc, created_at
   limit 1 for update skip locked;
  if n.id is null then return null; end if;
  perform public.cc_assign_number_internal(n.id, p_tenant, null);
  select * into n from public.cc_numbers where id = n.id;
  return n;
end $$;
revoke all on function public.cc_take_number(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cc_take_number(uuid, text, text) to service_role;

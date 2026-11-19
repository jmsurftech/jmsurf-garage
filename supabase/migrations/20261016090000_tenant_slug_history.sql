-- Company address history: when a company changes its slug, the old address keeps working by
-- forwarding to the new one (server.js). A slug taken by another company stops forwarding.
create table if not exists public.tenant_slug_history (
  slug text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  changed_at timestamptz not null default now()
);
create index if not exists tenant_slug_history_tenant_idx on public.tenant_slug_history (tenant_id);
alter table public.tenant_slug_history enable row level security;
-- No policies: only the server (service role) reads it.
revoke all on public.tenant_slug_history from anon, authenticated;

create or replace function public.tenants_slug_history()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- A slug in use by a company is never a forwarding address.
  if new.slug is not null then
    delete from public.tenant_slug_history where slug = lower(new.slug);
  end if;
  if tg_op = 'UPDATE' and old.slug is not null and lower(old.slug) is distinct from lower(coalesce(new.slug, '')) then
    insert into public.tenant_slug_history (slug, tenant_id, changed_at) values (lower(old.slug), new.id, now())
    on conflict (slug) do update set tenant_id = excluded.tenant_id, changed_at = excluded.changed_at;
  end if;
  return new;
end $$;

drop trigger if exists tenants_slug_history on public.tenants;
create trigger tenants_slug_history after insert or update of slug on public.tenants
for each row execute function public.tenants_slug_history();

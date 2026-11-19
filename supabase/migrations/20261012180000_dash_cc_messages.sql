-- JMSURF CALL CENTRE messaging: SMS conversations with callers through the
-- company's own Africa's Talking account (incoming SMS arrive on the callback).
create table if not exists public.cc_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  number text not null,
  body text not null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  agent_id uuid references public.cc_agents(id) on delete set null,
  status text not null default 'sent',
  provider_id text,
  cost numeric(12,4),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cc_messages_thread_idx on public.cc_messages (tenant_id, number, created_at desc);
alter table public.cc_messages enable row level security;
drop policy if exists cc_messages_tenant on public.cc_messages;
create policy cc_messages_tenant on public.cc_messages for select to authenticated using (tenant_id = public.current_user_tenant_id());
drop policy if exists cc_messages_read on public.cc_messages;
create policy cc_messages_read on public.cc_messages for update to authenticated using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());

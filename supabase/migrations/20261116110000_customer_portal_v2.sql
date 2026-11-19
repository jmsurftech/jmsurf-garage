-- Customer portal v2. Re-runnable.
--
-- Customers never sign in to the database: the portal talks to the app server (shop.js / portal.js)
-- with a customer session (customer_accounts / customer_sessions), and the server reads and writes
-- with the service key, always filtered by that session's tenant and customer. So every table here
-- has RLS for staff of the company only; anon has nothing.
--
-- 1. Quotes answered online: Accept (typed name as e-signature, optional comment) or Decline (reason).
-- 2. portal_messages: one thread per customer between the customer and the company, optional file
--    (private "documents" bucket, <tenant>/portal/<customer>/...).
-- 3. documents.shared_with_customer: files staff share with the customer in the portal.
-- 4. customer_profile_updates: contact changes a customer sends when the company reviews them first.

-- ═══════════════════════════════════════════════════════════════════ 1. quotes answered online
alter table public.quotes
  add column if not exists customer_signed_name text,
  add column if not exists customer_comment text,
  add column if not exists customer_responded_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists decline_reason text;

-- ═══════════════════════════════════════════════════════════════════ 2. messages
create table if not exists public.portal_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  sender text not null check (sender in ('customer', 'staff')),
  staff_user_id uuid,
  staff_name text,
  body text not null default '' check (length(body) <= 4000),
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  read_by_customer_at timestamptz,
  read_by_staff_at timestamptz,
  created_at timestamptz not null default now(),
  check (length(trim(body)) > 0 or attachment_path is not null)
);
create index if not exists portal_messages_thread_idx on public.portal_messages (tenant_id, customer_id, created_at);
create index if not exists portal_messages_unread_staff_idx on public.portal_messages (tenant_id, created_at desc)
  where sender = 'customer' and read_by_staff_at is null;
alter table public.portal_messages enable row level security;
drop policy if exists portal_messages_staff_select on public.portal_messages;
create policy portal_messages_staff_select on public.portal_messages for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
-- Staff only mark messages read from the browser; replies go through the server (it emails the customer).
drop policy if exists portal_messages_staff_update on public.portal_messages;
create policy portal_messages_staff_update on public.portal_messages for update to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
revoke all on public.portal_messages from anon, authenticated;
grant select, update (read_by_staff_at) on public.portal_messages to authenticated;
grant all on public.portal_messages to service_role;

-- ═══════════════════════════════════════════════════════════════════ 3. documents shared in the portal
alter table public.documents
  add column if not exists shared_with_customer boolean not null default false,
  add column if not exists shared_at timestamptz;
create index if not exists documents_portal_idx on public.documents (tenant_id, entity_id)
  where shared_with_customer and entity_type = 'customer';

-- ═══════════════════════════════════════════════════════════════════ 4. profile changes for review
create table if not exists public.customer_profile_updates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  changes jsonb not null check (jsonb_typeof(changes) = 'object'),
  previous jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'replaced')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists customer_profile_updates_pending_idx on public.customer_profile_updates (tenant_id, customer_id)
  where status = 'pending';
alter table public.customer_profile_updates enable row level security;
drop policy if exists customer_profile_updates_staff_select on public.customer_profile_updates;
create policy customer_profile_updates_staff_select on public.customer_profile_updates for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
-- Approving changes the sign-in phone too, so reviews go through the server (portal/profile-review).
revoke all on public.customer_profile_updates from anon, authenticated;
grant select on public.customer_profile_updates to authenticated;
grant all on public.customer_profile_updates to service_role;

-- ═══════════════════════════════════════════════════════════════════ unread counts for staff
/** Customer messages not yet read by staff, per customer, for the signed-in company. */
create or replace function public.portal_unread_by_customer()
returns table (customer_id uuid, unread bigint, last_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select m.customer_id, count(*)::bigint, max(m.created_at)
  from public.portal_messages m
  where m.tenant_id = public.current_user_tenant_id() and m.sender = 'customer' and m.read_by_staff_at is null
  group by m.customer_id
$$;
revoke all on function public.portal_unread_by_customer() from public, anon;
grant execute on function public.portal_unread_by_customer() to authenticated, service_role;

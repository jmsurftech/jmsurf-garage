-- JMSURF support tickets: a company raises a written ticket to JMSURF from the
-- Help centre, follows the replies there, and JMSURF answers from Admin → Support.
-- New tickets and company replies alert the owner (platform_alert_queue); JMSURF's
-- replies reach the company in the bell (shop_notifications) and by email
-- (emailed by the server's owner-alert loop, see platformcrm.js).

create table if not exists public.platform_tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  opened_by uuid,
  opener_name text,
  opener_email text,
  subject text not null,
  category text not null default 'question',
  priority text not null default 'normal',
  status text not null default 'open',
  page text,
  last_reply_by text not null default 'company',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint platform_tickets_status_chk check (status in ('open', 'answered', 'closed')),
  constraint platform_tickets_priority_chk check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint platform_tickets_category_chk check (category in ('question', 'problem', 'billing', 'feature', 'data', 'other'))
);
create index if not exists platform_tickets_tenant_idx on public.platform_tickets (tenant_id, updated_at desc);
create index if not exists platform_tickets_status_idx on public.platform_tickets (status, updated_at desc);

create table if not exists public.platform_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.platform_tickets(id) on delete cascade,
  from_jmsurf boolean not null default false,
  author_id uuid,
  author_name text,
  body text not null,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists platform_ticket_messages_ticket_idx on public.platform_ticket_messages (ticket_id, created_at);
create index if not exists platform_ticket_messages_unsent_idx on public.platform_ticket_messages (created_at) where from_jmsurf and emailed_at is null;

alter table public.platform_tickets enable row level security;
alter table public.platform_ticket_messages enable row level security;

drop policy if exists platform_tickets_read on public.platform_tickets;
create policy platform_tickets_read on public.platform_tickets for select to authenticated
  using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

drop policy if exists platform_ticket_messages_read on public.platform_ticket_messages;
create policy platform_ticket_messages_read on public.platform_ticket_messages for select to authenticated
  using (exists (select 1 from public.platform_tickets t where t.id = ticket_id
                 and (t.tenant_id = public.current_user_tenant_id() or public.is_platform_admin())));

grant select on public.platform_tickets, public.platform_ticket_messages to authenticated;

/** A company opens a support ticket to JMSURF. Returns the new ticket id. */
create or replace function public.platform_ticket_open(p_subject text, p_body text, p_category text default 'question', p_priority text default 'normal', p_page text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid := public.current_user_tenant_id(); me text; mail text; co text; new_id uuid; n bigint;
  subj text := left(trim(coalesce(p_subject, '')), 200); msg text := left(trim(coalesce(p_body, '')), 8000);
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if tid is null then raise exception 'Open your company first'; end if;
  if exists (select 1 from public.tenants where id = tid and slug = 'demo') then
    raise exception 'This is the shared demo. Create your own free company to contact JMSURF support, or chat with us on WhatsApp.';
  end if;
  if length(subj) < 3 then raise exception 'Write a short subject'; end if;
  if length(msg) < 5 then raise exception 'Tell us what you need help with'; end if;
  if (select count(*) from public.platform_tickets where tenant_id = tid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many tickets in the last hour. Reply on an open ticket instead.';
  end if;
  select display_name into me from public.profiles where user_id = auth.uid();
  select email into mail from auth.users where id = auth.uid();
  select business_name into co from public.tenants where id = tid;
  insert into public.platform_tickets (tenant_id, opened_by, opener_name, opener_email, subject, category, priority, page)
  values (tid, auth.uid(), coalesce(me, mail), mail, subj,
          case when p_category in ('question','problem','billing','feature','data','other') then p_category else 'question' end,
          case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
          left(p_page, 300))
  returning id, number into new_id, n;
  insert into public.platform_ticket_messages (ticket_id, from_jmsurf, author_id, author_name, body)
  values (new_id, false, auth.uid(), coalesce(me, mail), msg);
  insert into public.platform_alert_queue (event, title, body, link)
  values ('inquiry', format('Ticket #%s from %s: %s', n, coalesce(co, me, mail), subj), concat_ws(' · ', me, mail, left(msg, 300)), '/admin/support?ticket=' || new_id);
  return new_id;
end $$;
grant execute on function public.platform_ticket_open(text, text, text, text, text) to authenticated;

/** A reply on a ticket, by the company that owns it or by JMSURF (platform admin). */
create or replace function public.platform_ticket_reply(p_ticket uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.platform_tickets; admin boolean := public.is_platform_admin(); me text; msg text := left(trim(coalesce(p_body, '')), 8000); co text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into t from public.platform_tickets where id = p_ticket;
  if t.id is null then raise exception 'Ticket not found'; end if;
  if not admin and t.tenant_id is distinct from public.current_user_tenant_id() then raise exception 'Ticket not found'; end if;
  if length(msg) < 1 then raise exception 'Write a reply'; end if;
  select coalesce(display_name, (select email from auth.users where id = auth.uid())) into me from public.profiles where user_id = auth.uid();
  -- A platform admin replying from their own company's Help centre is the company, not JMSURF.
  if admin and t.tenant_id is distinct from public.current_user_tenant_id() then
    insert into public.platform_ticket_messages (ticket_id, from_jmsurf, author_id, author_name, body) values (t.id, true, auth.uid(), 'JMSURF support', msg);
    update public.platform_tickets set status = 'answered', last_reply_by = 'jmsurf', updated_at = now(), closed_at = null where id = t.id;
    insert into public.shop_notifications (tenant_id, user_id, kind, title, body, link, entity_type, entity_id)
    values (t.tenant_id, t.opened_by, 'support_reply', format('JMSURF support replied to ticket #%s', t.number), left(msg, 280), '/help?ticket=' || t.id, 'platform_ticket', t.id);
  else
    insert into public.platform_ticket_messages (ticket_id, from_jmsurf, author_id, author_name, body) values (t.id, false, auth.uid(), me, msg);
    update public.platform_tickets set status = 'open', last_reply_by = 'company', updated_at = now(), closed_at = null where id = t.id;
    select business_name into co from public.tenants where id = t.tenant_id;
    insert into public.platform_alert_queue (event, title, body, link)
    values ('inquiry', format('Reply on ticket #%s from %s', t.number, coalesce(co, me)), left(msg, 300), '/admin/support?ticket=' || t.id);
  end if;
end $$;
grant execute on function public.platform_ticket_reply(uuid, text) to authenticated;

/** Close or reopen a ticket (the company that owns it, or JMSURF). */
create or replace function public.platform_ticket_set_status(p_ticket uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.platform_tickets;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_status not in ('open', 'answered', 'closed') then raise exception 'Unknown status'; end if;
  select * into t from public.platform_tickets where id = p_ticket;
  if t.id is null or (not public.is_platform_admin() and t.tenant_id is distinct from public.current_user_tenant_id()) then raise exception 'Ticket not found'; end if;
  update public.platform_tickets set status = p_status, updated_at = now(),
    closed_at = case when p_status = 'closed' then now() else null end where id = t.id;
end $$;
grant execute on function public.platform_ticket_set_status(uuid, text) to authenticated;

/** Admin → Support: every ticket with its company. */
create or replace function public.platform_tickets_admin()
returns table (id uuid, number bigint, tenant_id uuid, company text, slug text, opener_name text, opener_email text, subject text,
               category text, priority text, status text, last_reply_by text, created_at timestamptz, updated_at timestamptz, messages bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  return query
  select t.id, t.number, t.tenant_id, te.business_name, te.slug, t.opener_name, t.opener_email, t.subject, t.category, t.priority, t.status,
         t.last_reply_by, t.created_at, t.updated_at, (select count(*) from public.platform_ticket_messages m where m.ticket_id = t.id)
  from public.platform_tickets t left join public.tenants te on te.id = t.tenant_id
  order by (t.status = 'closed'), t.updated_at desc
  limit 500;
end $$;
grant execute on function public.platform_tickets_admin() to authenticated;

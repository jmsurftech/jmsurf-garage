-- Automatic alerts for everything that needs someone's attention: approvals,
-- quotes, CRM leads and tags, activities, project tasks, tickets, leave,
-- payments and meetings. Triggers queue an alert; the server (events.js) sends
-- it on the channels the company chose per event in System → Notifications
-- (business_settings.erp_settings.notifications): bell, email, SMS, WhatsApp.

create table if not exists public.alert_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event text not null,
  title text not null,
  body text,
  link text,
  user_ids uuid[] not null default '{}',
  roles text[] not null default '{}',
  actor uuid,
  entity_type text,
  entity_id uuid,
  status text not null default 'new' check (status in ('new', 'waiting', 'done', 'failed')),
  next_at timestamptz,
  detail text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists alert_queue_todo_idx on public.alert_queue (status, next_at) where status in ('new', 'waiting');
alter table public.alert_queue enable row level security;
-- Only the server reads the queue (service role); companies see the bell and the delivery log.

/** One line per alert sent, for the log and so scheduled reminders go once. */
create table if not exists public.alert_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event text not null,
  entity_id uuid,
  slot text not null default '',
  user_id uuid,
  channel text not null,
  recipient text,
  status text not null default 'sent',
  detail text,
  created_at timestamptz not null default now(),
  unique (event, entity_id, slot, user_id, channel)
);
alter table public.alert_log enable row level security;
drop policy if exists alert_log_read on public.alert_log;
create policy alert_log_read on public.alert_log for select to authenticated using (tenant_id = public.current_user_tenant_id());

/** Queues an alert. Never fails the change that caused it. */
create or replace function public.queue_alert(p_tenant uuid, p_event text, p_title text, p_body text, p_link text,
  p_users uuid[] default '{}', p_roles text[] default '{}', p_entity_type text default null, p_entity_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid[];
begin
  u := array(select distinct x from unnest(coalesce(p_users, '{}')) x where x is not null);
  if p_tenant is null or (cardinality(u) = 0 and cardinality(coalesce(p_roles, '{}')) = 0) then return; end if;
  insert into public.alert_queue (tenant_id, event, title, body, link, user_ids, roles, actor, entity_type, entity_id)
  values (p_tenant, p_event, left(p_title, 200), left(p_body, 1000), p_link, u, coalesce(p_roles, '{}'), auth.uid(), p_entity_type, p_entity_id);
exception when others then
  raise warning 'queue_alert % failed: %', p_event, sqlerrm;
end $$;
revoke all on function public.queue_alert(uuid, text, text, text, text, uuid[], text[], text, uuid) from public, anon, authenticated;

/** People to alert (named people plus everyone in the roles), with email and phone. Server only. */
create or replace function public.alert_contacts(p_tenant uuid, p_users uuid[], p_roles text[])
returns table (user_id uuid, name text, email text, phone text)
language sql stable security definer set search_path = public, auth as $$
  with ids as (
    select unnest(coalesce(p_users, '{}')) as uid
    union
    select m.user_id from public.tenant_members m where m.tenant_id = p_tenant and coalesce(m.status, 'active') = 'active'
      and (m.role::text = any(coalesce(p_roles, '{}')) or (m.is_owner and 'admin' = any(coalesce(p_roles, '{}'))))
  )
  select i.uid, coalesce(p.display_name, split_part(u.email, '@', 1)), u.email::text,
    coalesce(nullif(p.phone, ''), (select e.phone from public.hr_employees e where e.user_id = i.uid limit 1))
  from ids i
  join auth.users u on u.id = i.uid
  left join public.profiles p on p.user_id = i.uid
  where exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant and m.user_id = i.uid)
$$;
revoke all on function public.alert_contacts(uuid, uuid[], text[]) from public, anon, authenticated;

-- ── Approvals ───────────────────────────────────────────────────────────────
create or replace function public.alert_approvals() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    perform public.queue_alert(NEW.tenant_id, 'approval_requested', 'Approval needed: ' || coalesce(NEW.title, NEW.doc_type || ' ' || coalesce(NEW.doc_number, '')),
      coalesce(NEW.requested_by_name, 'Someone') || ' asks you to approve ' || coalesce(NEW.doc_number, 'a ' || replace(NEW.doc_type, '_', ' ')) ||
      case when NEW.amount is not null then ' (KES ' || to_char(NEW.amount, 'FM999,999,999,990.00') || ')' else '' end || '.',
      '/approvals', NEW.approvers, '{}', 'approval', NEW.id);
  elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status and NEW.status in ('approved', 'rejected') then
    perform public.queue_alert(NEW.tenant_id, 'approval_decided', initcap(NEW.status) || ': ' || coalesce(NEW.title, NEW.doc_number, NEW.doc_type),
      coalesce(NEW.decided_by_name, 'An approver') || ' ' || NEW.status || ' ' || coalesce(NEW.doc_number, 'your request') ||
      case when coalesce(NEW.comment, '') <> '' then ': ' || NEW.comment else '.' end,
      '/approvals', array[NEW.requested_by], '{}', 'approval', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_approvals on public.approval_requests;
create trigger alert_approvals after insert or update of status on public.approval_requests for each row execute function public.alert_approvals();

-- ── Quotes ──────────────────────────────────────────────────────────────────
create or replace function public.alert_quotes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status is distinct from OLD.status and NEW.status in ('accepted', 'declined', 'rejected', 'expired', 'invoiced') then
    perform public.queue_alert(NEW.tenant_id, 'quote_' || case when NEW.status = 'rejected' then 'declined' else NEW.status end,
      'Quote ' || coalesce(NEW.quote_number, '') || ' ' || NEW.status,
      coalesce(NEW.customer_name, 'The customer') || ' · KES ' || to_char(coalesce(NEW.total, 0), 'FM999,999,999,990.00'),
      '/sales/quotes/' || NEW.id, array[NEW.created_by, NEW.salesperson_id], '{}', 'quote', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_quotes on public.quotes;
create trigger alert_quotes after update of status on public.quotes for each row execute function public.alert_quotes();

-- ── CRM: leads assigned, tagged, won; activities assigned ──────────────────
create or replace function public.alert_leads() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tags text;
begin
  if NEW.salesperson_id is not null and (TG_OP = 'INSERT' or NEW.salesperson_id is distinct from OLD.salesperson_id) then
    perform public.queue_alert(NEW.tenant_id, 'lead_assigned', 'New ' || coalesce(NEW.type, 'lead') || ' for you: ' || NEW.name,
      concat_ws(' · ', NEW.contact_name, NEW.partner_name, NEW.phone, case when NEW.expected_revenue > 0 then 'KES ' || to_char(NEW.expected_revenue, 'FM999,999,999,990') end),
      '/crm/lead/' || NEW.id, array[NEW.salesperson_id], '{}', 'lead', NEW.id);
  end if;
  if TG_OP = 'UPDATE' and NEW.tag_ids is distinct from OLD.tag_ids and cardinality(coalesce(NEW.tag_ids, '{}')) > cardinality(coalesce(OLD.tag_ids, '{}')) then
    select string_agg(t.name, ', ') into v_tags from public.crm_tags t where t.id = any(NEW.tag_ids) and not (t.id = any(coalesce(OLD.tag_ids, '{}')));
    perform public.queue_alert(NEW.tenant_id, 'lead_tagged', 'Tagged ' || coalesce(v_tags, '') || ': ' || NEW.name,
      'A tag was added to this ' || coalesce(NEW.type, 'lead') || '.', '/crm/lead/' || NEW.id, array[NEW.salesperson_id], '{}', 'lead', NEW.id);
  end if;
  if TG_OP = 'UPDATE' and NEW.won_status is distinct from OLD.won_status and NEW.won_status in ('won', 'lost') then
    perform public.queue_alert(NEW.tenant_id, 'lead_' || NEW.won_status, initcap(NEW.won_status) || ': ' || NEW.name,
      case when NEW.expected_revenue > 0 then 'KES ' || to_char(NEW.expected_revenue, 'FM999,999,999,990') else '' end,
      '/crm/lead/' || NEW.id, array[NEW.salesperson_id], array['admin', 'manager'], 'lead', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_leads on public.crm_leads;
create trigger alert_leads after insert or update of salesperson_id, tag_ids, won_status on public.crm_leads for each row execute function public.alert_leads();

create or replace function public.alert_crm_activities() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead text;
begin
  if NEW.assigned_to is not null and (TG_OP = 'INSERT' or NEW.assigned_to is distinct from OLD.assigned_to) then
    select name into v_lead from public.crm_leads where id = NEW.lead_id;
    perform public.queue_alert(NEW.tenant_id, 'activity_assigned', 'To do: ' || coalesce(NEW.summary, 'follow-up') || coalesce(' · ' || v_lead, ''),
      case when NEW.due_date is not null then 'Due ' || to_char(NEW.due_date, 'DD Mon YYYY') else 'No due date' end,
      '/crm/lead/' || NEW.lead_id, array[NEW.assigned_to], '{}', 'crm_activity', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_crm_activities on public.crm_activities;
create trigger alert_crm_activities after insert or update of assigned_to on public.crm_activities for each row execute function public.alert_crm_activities();

-- ── Records: project tasks, helpdesk tickets and anything else assigned ────
create or replace function public.alert_records() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_event text; v_what text; v_link text;
begin
  if NEW.assigned_to is null or not (TG_OP = 'INSERT' or NEW.assigned_to is distinct from OLD.assigned_to) then return NEW; end if;
  v_event := case when NEW.app = 'projects' and NEW.kind = 'task' then 'task_assigned' when NEW.app = 'helpdesk' then 'ticket_assigned' else 'record_assigned' end;
  v_what := case v_event when 'task_assigned' then 'Task' when 'ticket_assigned' then 'Ticket' else initcap(replace(NEW.kind, '_', ' ')) end;
  v_link := '/apps/' || NEW.app || '/' || NEW.kind || '/' || NEW.id;
  perform public.queue_alert(NEW.tenant_id, v_event, v_what || ' for you: ' || coalesce(NEW.title, NEW.number, ''),
    concat_ws(' · ', NEW.number, case when NEW.priority is not null then 'Priority ' || NEW.priority end, case when NEW.due_date is not null then 'Due ' || to_char(NEW.due_date, 'DD Mon YYYY') end),
    v_link, array[NEW.assigned_to], '{}', NEW.kind, NEW.id);
  return NEW;
end $$;
drop trigger if exists alert_records on public.app_records;
create trigger alert_records after insert or update of assigned_to on public.app_records for each row execute function public.alert_records();

create or replace function public.alert_support_tickets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.assigned_to is not null and (TG_OP = 'INSERT' or NEW.assigned_to is distinct from OLD.assigned_to) then
    perform public.queue_alert(NEW.tenant_id, 'ticket_assigned', 'Ticket for you: ' || coalesce(NEW.subject, NEW.ticket_no::text, ''),
      concat_ws(' · ', NEW.customer_name, 'Priority ' || NEW.priority), '/tickets', array[NEW.assigned_to], '{}', 'ticket', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_support_tickets on public.support_tickets;
create trigger alert_support_tickets after insert or update of assigned_to on public.support_tickets for each row execute function public.alert_support_tickets();

-- ── Leave ───────────────────────────────────────────────────────────────────
create or replace function public.alert_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select concat_ws(' ', e.first_name, e.last_name) into v_name from public.hr_employees e where e.id = NEW.employee_id;
  if TG_OP = 'INSERT' then
    perform public.queue_alert(NEW.tenant_id, 'leave_requested', 'Leave request: ' || coalesce(v_name, 'an employee'),
      to_char(NEW.start_date, 'DD Mon') || ' to ' || to_char(NEW.end_date, 'DD Mon YYYY') || ' · ' || coalesce(NEW.days, 0) || ' days' || coalesce(' · ' || NEW.reason, ''),
      '/hrm/leave', '{}', array['admin', 'manager'], 'leave', NEW.id);
  elsif NEW.status is distinct from OLD.status and NEW.status in ('approved', 'rejected', 'declined') then
    perform public.queue_alert(NEW.tenant_id, 'leave_decided', 'Leave ' || NEW.status,
      to_char(NEW.start_date, 'DD Mon') || ' to ' || to_char(NEW.end_date, 'DD Mon YYYY') || coalesce(': ' || NEW.decision_note, ''),
      '/hrm/leave', array[NEW.requested_by, (select user_id from public.hr_employees where id = NEW.employee_id)], '{}', 'leave', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_leave on public.hr_leave_requests;
create trigger alert_leave after insert or update of status on public.hr_leave_requests for each row execute function public.alert_leave();

-- ── Payments received ───────────────────────────────────────────────────────
create or replace function public.alert_payments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.queue_alert(NEW.tenant_id, 'payment_received', 'Payment received: KES ' || to_char(NEW.amount, 'FM999,999,999,990.00'),
    concat_ws(' · ', NEW.customer_name, NEW.method, NEW.reference, NEW.payment_number), '/payments', '{}', array['admin', 'manager'], 'payment', NEW.id);
  return NEW;
end $$;
drop trigger if exists alert_payments on public.payments_received;
create trigger alert_payments after insert on public.payments_received for each row execute function public.alert_payments();

-- ── Calendar: invitations (reminders are scheduled by the server) ─────────
create or replace function public.alert_calendar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if cardinality(coalesce(NEW.attendees, '{}')) > 0 and (TG_OP = 'INSERT' or NEW.attendees is distinct from OLD.attendees or NEW.start_at is distinct from OLD.start_at) then
    perform public.queue_alert(NEW.tenant_id, 'meeting_invited', case when TG_OP = 'INSERT' then 'Invitation: ' else 'Updated: ' end || NEW.title,
      to_char(NEW.start_at at time zone 'Africa/Nairobi', 'Dy DD Mon, HH24:MI') || coalesce(' · ' || NEW.location, ''),
      '/calendar', array(select x from unnest(NEW.attendees) x where x is distinct from NEW.created_by), '{}', 'calendar_event', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_calendar on public.calendar_events;
create trigger alert_calendar after insert or update of attendees, start_at on public.calendar_events for each row execute function public.alert_calendar();

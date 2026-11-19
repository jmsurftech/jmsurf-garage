-- HRM leave workflow and work from home.
--
-- Leave goes through two stages: the employee's line manager first
-- (hr_employees.manager_id -> that manager's login), then HR. With no line
-- manager login, or with the manager stage switched off in
-- erp_settings.hrm.leave.manager_stage, it goes straight to HR.
-- 'pending' stays the HR stage so existing rows keep their meaning.
--
-- Days are counted here: the company's working days (erp_settings.hr.workdays,
-- Mon-Sat when not set) between the two dates, without public holidays.
-- A half day counts 0.5.
--
-- Cover: the employee may name a colleague who stands in. It is a notice only
-- (alert plus a banner in My Space); no permissions move.
--
-- Return early: approved leave can end before its last day. end_date becomes
-- the real last day (payroll and balances read it), planned_end_date keeps
-- what was booked, and the unused days go back to the balance.
--
-- Staff write leave and work-from-home requests only through the functions
-- below; HR keeps direct table access.
--
-- Re-runnable.

-- ── 1. Leave request columns and statuses ──────────────────────────────────
alter table public.hr_leave_requests
  add column if not exists half_day boolean not null default false,
  add column if not exists cover_employee_id uuid references public.hr_employees(id) on delete set null,
  add column if not exists manager_user_id uuid,
  add column if not exists manager_decided_by uuid,
  add column if not exists manager_decided_at timestamptz,
  add column if not exists manager_note text,
  add column if not exists planned_end_date date,
  add column if not exists returned_early_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.hr_leave_requests drop constraint if exists hr_leave_requests_status_check;
alter table public.hr_leave_requests add constraint hr_leave_requests_status_check
  check (status in ('pending_manager', 'pending', 'approved', 'rejected', 'cancelled'));

create index if not exists hr_leave_requests_dates_idx on public.hr_leave_requests (tenant_id, start_date, end_date);
create index if not exists hr_leave_requests_manager_idx on public.hr_leave_requests (manager_user_id) where status = 'pending_manager';
create index if not exists hr_leave_requests_cover_idx on public.hr_leave_requests (cover_employee_id) where cover_employee_id is not null;

-- Staff no longer insert or update rows directly (the functions check dates,
-- balance and stage). They still read their own; line managers read the
-- requests waiting for them.
drop policy if exists hr_leave_self_insert on public.hr_leave_requests;
drop policy if exists hr_leave_self_update on public.hr_leave_requests;
drop policy if exists hr_leave_manager_read on public.hr_leave_requests;
create policy hr_leave_manager_read on public.hr_leave_requests for select to authenticated
  using (manager_user_id = auth.uid());

-- ── 2. Helpers ─────────────────────────────────────────────────────────────
/** Days of the week the company works (0 = Sunday), from erp_settings.hr.workdays; Mon-Sat when not set. */
create or replace function public.hr_workdays(p_tenant uuid) returns int[]
language plpgsql stable security definer set search_path = public as $$
declare j jsonb; r int[];
begin
  select erp_settings -> 'hr' -> 'workdays' into j from public.business_settings where tenant_id = p_tenant limit 1;
  if jsonb_typeof(j) = 'array' then
    select array_agg(x::int) into r from jsonb_array_elements_text(j) x where x ~ '^[0-6]$';
  end if;
  return coalesce(r, array[1, 2, 3, 4, 5, 6]);
end $$;

/** Working days from p_from to p_to inclusive, without public holidays. */
create or replace function public.hr_working_days(p_tenant uuid, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select count(*)::numeric
  from generate_series(p_from, p_to, interval '1 day') d
  where p_from is not null and p_to is not null and p_to >= p_from
    and extract(dow from d)::int = any (public.hr_workdays(p_tenant))
    and not exists (select 1 from public.hr_holidays h where h.tenant_id = p_tenant and h.date = d::date)
$$;

/** Whether leave goes to the line manager before HR (erp_settings.hrm.leave.manager_stage, on unless set to false). */
create or replace function public.hr_leave_manager_stage(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select erp_settings -> 'hrm' -> 'leave' ->> 'manager_stage' from public.business_settings where tenant_id = p_tenant limit 1), 'true') <> 'false'
$$;

/** The login of the employee's line manager, when there is one still working here. */
create or replace function public.hr_line_manager_user(p_employee uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.user_id
  from public.hr_employees e
  join public.hr_employees m on m.id = e.manager_id and m.tenant_id = e.tenant_id
  where e.id = p_employee and m.user_id is not null and m.user_id is distinct from e.user_id
    and coalesce(m.status, 'active') not in ('terminated', 'resigned')
  limit 1
$$;

/** Today in Kenya. */
create or replace function public.hr_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Africa/Nairobi')::date $$;

/** One history line for the signed-in person. */
create or replace function public.hr_history_entry(p_action text, p_note text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('at', now(), 'by', coalesce((select display_name from public.profiles where user_id = auth.uid() limit 1), 'Someone'),
    'by_user', auth.uid(), 'action', p_action, 'note', nullif(btrim(coalesce(p_note, '')), ''))
$$;

revoke all on function public.hr_workdays(uuid) from public, anon;
revoke all on function public.hr_line_manager_user(uuid) from public, anon, authenticated;
revoke all on function public.hr_history_entry(text, text) from public, anon, authenticated;
grant execute on function public.hr_workdays(uuid) to authenticated;
grant execute on function public.hr_working_days(uuid, date, date) to authenticated;
grant execute on function public.hr_leave_manager_stage(uuid) to authenticated;
grant execute on function public.hr_today() to authenticated;

/** Colleagues in the caller's company (names only), for cover pickers and approval lists. */
create or replace function public.hr_colleagues()
returns table (id uuid, name text, department text)
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid := public.current_user_tenant_id();
begin
  if v_tenant is null then return; end if;
  if not public.hr_can() and not exists (select 1 from public.hr_employees x where x.tenant_id = v_tenant and x.user_id = auth.uid()) then return; end if;
  return query
    select e.id, concat_ws(' ', e.first_name, e.other_names, e.last_name), d.name
    from public.hr_employees e left join public.hr_departments d on d.id = e.department_id
    where e.tenant_id = v_tenant and coalesce(e.status, 'active') not in ('terminated', 'resigned')
    order by e.first_name, e.last_name;
end $$;
revoke all on function public.hr_colleagues() from public, anon;
grant execute on function public.hr_colleagues() to authenticated;

-- ── 3. Leave: request, decide, cancel, return early ─────────────────────────
/** Creates a leave request, or changes one still waiting or rejected (it then starts the approval again). Returns its id. */
create or replace function public.hr_leave_save(
  p_id uuid default null, p_employee uuid default null, p_type uuid default null, p_start date default null, p_end date default null,
  p_half_day boolean default false, p_reason text default null, p_cover uuid default null, p_document uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  v_hr boolean := coalesce(public.hr_can(), false);
  v_old public.hr_leave_requests;
  v_emp public.hr_employees;
  v_type public.hr_leave_types;
  v_cover public.hr_employees;
  v_half boolean := coalesce(p_half_day, false);
  v_days numeric; v_used numeric; v_mgr uuid; v_status text; v_id uuid;
begin
  if v_tenant is null or auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_id is not null then
    select * into v_old from public.hr_leave_requests where id = p_id and tenant_id = v_tenant for update;
    if v_old.id is null then raise exception 'Leave request not found'; end if;
    if v_old.status not in ('pending_manager', 'pending', 'rejected') then raise exception 'Only a request that is waiting or rejected can be changed'; end if;
    p_employee := v_old.employee_id;
  end if;
  if p_employee is null then
    select id into p_employee from public.hr_employees where tenant_id = v_tenant and user_id = auth.uid() limit 1;
    if p_employee is null then raise exception 'Your login is not linked to an employee record. Ask HR to link it.'; end if;
  end if;
  select * into v_emp from public.hr_employees where id = p_employee and tenant_id = v_tenant;
  if v_emp.id is null then raise exception 'Employee not found'; end if;
  if v_emp.user_id is distinct from auth.uid() and not v_hr then raise exception 'You can only request leave for yourself'; end if;

  select * into v_type from public.hr_leave_types where id = p_type and tenant_id = v_tenant;
  if v_type.id is null or not v_type.active then raise exception 'Choose the type of leave'; end if;
  if v_type.gender is not null and v_emp.gender is not null and v_type.gender <> v_emp.gender then raise exception '% is not available for this employee', v_type.name; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Check the dates: the last day is before the first'; end if;
  if v_half and p_end <> p_start then raise exception 'A half day starts and ends on the same day'; end if;

  v_days := public.hr_working_days(v_tenant, p_start, p_end);
  if v_days <= 0 then raise exception 'Those dates have no working days'; end if;
  if v_half then v_days := 0.5; end if;

  if exists (select 1 from public.hr_leave_requests r where r.employee_id = p_employee and r.id is distinct from p_id
             and r.status in ('pending_manager', 'pending', 'approved') and r.start_date <= p_end and r.end_date >= p_start) then
    raise exception 'Those dates overlap another leave request';
  end if;
  if coalesce(v_type.days_per_year, 0) > 0 then
    select coalesce(sum(r.days), 0) into v_used from public.hr_leave_requests r
     where r.employee_id = p_employee and r.leave_type_id = v_type.id and r.id is distinct from p_id
       and r.status in ('pending_manager', 'pending', 'approved') and extract(year from r.start_date) = extract(year from p_start);
    if v_used + v_days > v_type.days_per_year then
      raise exception 'Not enough % days: % left this year', lower(v_type.name), greatest(0, v_type.days_per_year - v_used);
    end if;
  end if;
  if v_type.requires_document and coalesce(p_document, v_old.document_id) is null then
    raise exception '% needs a supporting document', v_type.name;
  end if;

  if p_cover is not null then
    select * into v_cover from public.hr_employees where id = p_cover and tenant_id = v_tenant;
    if v_cover.id is null or coalesce(v_cover.status, 'active') in ('terminated', 'resigned') then raise exception 'Cover person not found'; end if;
    if v_cover.id = p_employee then raise exception 'Choose someone else to cover'; end if;
    if exists (select 1 from public.hr_leave_requests r where r.employee_id = p_cover and r.status = 'approved'
               and r.start_date <= p_end and r.end_date >= p_start) then
      raise exception '% is on leave during those dates. Choose someone else to cover.', v_cover.first_name;
    end if;
  end if;

  v_mgr := case when public.hr_leave_manager_stage(v_tenant) then public.hr_line_manager_user(p_employee) end;
  v_status := case when v_mgr is not null then 'pending_manager' else 'pending' end;

  if p_id is null then
    insert into public.hr_leave_requests (tenant_id, employee_id, leave_type_id, start_date, end_date, days, half_day, reason, cover_employee_id,
      document_id, status, manager_user_id, requested_by, history)
    values (v_tenant, p_employee, v_type.id, p_start, p_end, v_days, v_half, nullif(btrim(coalesce(p_reason, '')), ''), p_cover,
      p_document, v_status, v_mgr, auth.uid(), jsonb_build_array(public.hr_history_entry('requested')))
    returning id into v_id;
  else
    update public.hr_leave_requests set leave_type_id = v_type.id, start_date = p_start, end_date = p_end, days = v_days, half_day = v_half,
      reason = nullif(btrim(coalesce(p_reason, '')), ''), cover_employee_id = p_cover, document_id = coalesce(p_document, document_id),
      status = v_status, manager_user_id = v_mgr, manager_decided_by = null, manager_decided_at = null, manager_note = null,
      decided_by = null, decided_at = null, decision_note = null, updated_at = now(),
      history = coalesce(history, '[]'::jsonb) || public.hr_history_entry(case when v_old.status = 'rejected' then 'resubmitted' else 'edited' end)
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

/** Approves or rejects a request at its current stage. The line manager approves first, then HR. HR can decide at either stage. */
create or replace function public.hr_leave_decide(p_id uuid, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  v_hr boolean := coalesce(public.hr_can(), false);
  r public.hr_leave_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_mgr boolean;
begin
  select * into r from public.hr_leave_requests where id = p_id and tenant_id = v_tenant for update;
  if r.id is null then raise exception 'Leave request not found'; end if;
  v_mgr := coalesce(r.manager_user_id = auth.uid(), false);
  if r.status = 'pending_manager' then
    if not (v_mgr or v_hr) then raise exception 'This request is waiting for the line manager'; end if;
  elsif r.status = 'pending' then
    if not v_hr then raise exception 'HR decides this request'; end if;
  else
    raise exception 'This request is already %', r.status;
  end if;
  if exists (select 1 from public.hr_employees e where e.id = r.employee_id and e.user_id = auth.uid())
     and not public.has_role(auth.uid(), 'admin') then
    raise exception 'Someone else must decide your own leave';
  end if;

  if not coalesce(p_approve, false) then
    if v_note is null then raise exception 'Say why it is rejected'; end if;
    update public.hr_leave_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now(),
      manager_decided_by = case when r.status = 'pending_manager' then auth.uid() else manager_decided_by end,
      manager_decided_at = case when r.status = 'pending_manager' then now() else manager_decided_at end,
      manager_note = case when r.status = 'pending_manager' then v_note else manager_note end,
      history = coalesce(history, '[]'::jsonb) || public.hr_history_entry(case when r.status = 'pending_manager' and not v_hr then 'rejected by manager' else 'rejected' end, v_note)
    where id = p_id;
    return 'rejected';
  end if;

  if r.status = 'pending_manager' and not v_hr then
    update public.hr_leave_requests set status = 'pending', manager_decided_by = auth.uid(), manager_decided_at = now(), manager_note = v_note, updated_at = now(),
      history = coalesce(history, '[]'::jsonb) || public.hr_history_entry('approved by manager', v_note)
    where id = p_id;
    return 'pending';
  end if;

  update public.hr_leave_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now(),
    manager_decided_by = case when r.status = 'pending_manager' then auth.uid() else manager_decided_by end,
    manager_decided_at = case when r.status = 'pending_manager' then now() else manager_decided_at end,
    history = coalesce(history, '[]'::jsonb) || public.hr_history_entry('approved', v_note)
  where id = p_id;
  return 'approved';
end $$;

/** Closes a request: anything waiting or rejected, or approved leave that has not started. */
create or replace function public.hr_leave_cancel(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  r public.hr_leave_requests;
begin
  select * into r from public.hr_leave_requests where id = p_id and tenant_id = v_tenant for update;
  if r.id is null then raise exception 'Leave request not found'; end if;
  if not public.hr_can() and not exists (select 1 from public.hr_employees e where e.id = r.employee_id and e.user_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;
  if r.status = 'cancelled' then raise exception 'This request is already closed'; end if;
  if r.status = 'approved' and r.start_date <= public.hr_today() then
    raise exception 'This leave has started. Use Return early instead.';
  end if;
  update public.hr_leave_requests set status = 'cancelled', updated_at = now(),
    history = coalesce(history, '[]'::jsonb) || public.hr_history_entry('cancelled', p_note)
  where id = p_id;
end $$;

/** Ends approved leave early: p_last_day is the last day off. The unused days go back to the balance. */
create or replace function public.hr_leave_return_early(p_id uuid, p_last_day date, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  v_hr boolean := coalesce(public.hr_can(), false);
  r public.hr_leave_requests;
  v_days numeric; v_back numeric; v_name text; v_emp_user uuid; v_cover_user uuid;
begin
  select * into r from public.hr_leave_requests where id = p_id and tenant_id = v_tenant for update;
  if r.id is null then raise exception 'Leave request not found'; end if;
  select concat_ws(' ', first_name, last_name), user_id into v_name, v_emp_user from public.hr_employees where id = r.employee_id;
  if not v_hr and v_emp_user is distinct from auth.uid() then raise exception 'Not allowed'; end if;
  if r.status <> 'approved' then raise exception 'Only approved leave can end early'; end if;
  if r.half_day then raise exception 'A half day cannot end early'; end if;
  if p_last_day is null or p_last_day < r.start_date then raise exception 'The last day off cannot be before the leave starts. Cancel the leave instead.'; end if;
  if p_last_day >= r.end_date then raise exception 'Pick a day before %', to_char(r.end_date, 'DD Mon YYYY'); end if;

  v_days := public.hr_working_days(v_tenant, r.start_date, p_last_day);
  v_back := greatest(0, r.days - v_days);
  update public.hr_leave_requests set planned_end_date = coalesce(planned_end_date, end_date), end_date = p_last_day, days = v_days,
    returned_early_at = now(), updated_at = now(),
    history = coalesce(history, '[]'::jsonb) || public.hr_history_entry('returned early',
      concat_ws(' · ', 'Last day off ' || to_char(p_last_day, 'DD Mon YYYY'), v_back || ' day' || case when v_back = 1 then '' else 's' end || ' back to the balance', nullif(btrim(coalesce(p_note, '')), '')))
  where id = p_id;

  select user_id into v_cover_user from public.hr_employees where id = r.cover_employee_id;
  perform public.queue_alert(v_tenant, 'leave_decided', coalesce(v_name, 'An employee') || ' is back early',
    'Leave now ends ' || to_char(p_last_day, 'DD Mon YYYY') || ' (was ' || to_char(r.end_date, 'DD Mon YYYY') || ')',
    '/me?tab=leave', array(select x from unnest(array[v_emp_user, v_cover_user]) x where x is distinct from auth.uid()),
    case when v_hr then '{}'::text[] else array['admin', 'manager'] end, 'leave', r.id);
  return v_back;
end $$;

/** Who is off between two dates. HR sees everything; others see approved leave plus their own and their team's requests. Leave types only show to HR, the employee and their manager. */
create or replace function public.hr_leave_board(p_from date, p_to date)
returns table (id uuid, employee_id uuid, employee_name text, leave_type text, start_date date, end_date date, half_day boolean, status text)
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid := public.current_user_tenant_id(); v_hr boolean := coalesce(public.hr_can(), false);
begin
  if v_tenant is null then return; end if;
  if not v_hr and not exists (select 1 from public.hr_employees x where x.tenant_id = v_tenant and x.user_id = auth.uid()) then return; end if;
  return query
    select r.id, r.employee_id, concat_ws(' ', e.first_name, e.last_name),
      case when v_hr or e.user_id = auth.uid() or r.manager_user_id = auth.uid() then t.name end,
      r.start_date, r.end_date, r.half_day, r.status
    from public.hr_leave_requests r
    join public.hr_employees e on e.id = r.employee_id
    left join public.hr_leave_types t on t.id = r.leave_type_id
    where r.tenant_id = v_tenant and r.start_date <= p_to and r.end_date >= p_from
      and (r.status = 'approved'
           or (r.status in ('pending_manager', 'pending') and (v_hr or e.user_id = auth.uid() or r.manager_user_id = auth.uid())))
    order by r.start_date, e.first_name;
end $$;

/** Leave where the signed-in person was named as cover, from today on. */
create or replace function public.hr_leave_my_cover()
returns table (id uuid, employee_name text, start_date date, end_date date, status text)
language sql stable security definer set search_path = public as $$
  select r.id, concat_ws(' ', e.first_name, e.last_name), r.start_date, r.end_date, r.status
  from public.hr_leave_requests r
  join public.hr_employees e on e.id = r.employee_id
  join public.hr_employees me on me.id = r.cover_employee_id
  where me.user_id = auth.uid() and r.tenant_id = public.current_user_tenant_id()
    and r.status in ('pending_manager', 'pending', 'approved') and r.end_date >= public.hr_today()
  order by r.start_date
$$;

revoke all on function public.hr_leave_save(uuid, uuid, uuid, date, date, boolean, text, uuid, uuid) from public, anon;
revoke all on function public.hr_leave_decide(uuid, boolean, text) from public, anon;
revoke all on function public.hr_leave_cancel(uuid, text) from public, anon;
revoke all on function public.hr_leave_return_early(uuid, date, text) from public, anon;
revoke all on function public.hr_leave_board(date, date) from public, anon;
revoke all on function public.hr_leave_my_cover() from public, anon;
grant execute on function public.hr_leave_save(uuid, uuid, uuid, date, date, boolean, text, uuid, uuid) to authenticated;
grant execute on function public.hr_leave_decide(uuid, boolean, text) to authenticated;
grant execute on function public.hr_leave_cancel(uuid, text) to authenticated;
grant execute on function public.hr_leave_return_early(uuid, date, text) to authenticated;
grant execute on function public.hr_leave_board(date, date) to authenticated;
grant execute on function public.hr_leave_my_cover() to authenticated;

-- ── 4. Leave alerts for the new stages ─────────────────────────────────────
create or replace function public.alert_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_emp_user uuid; v_cover_user uuid; v_span text;
begin
  if TG_OP = 'UPDATE' and NEW.status is not distinct from OLD.status then return NEW; end if;
  select concat_ws(' ', e.first_name, e.last_name), e.user_id into v_name, v_emp_user from public.hr_employees e where e.id = NEW.employee_id;
  select e.user_id into v_cover_user from public.hr_employees e where e.id = NEW.cover_employee_id;
  v_span := to_char(NEW.start_date, 'DD Mon') || ' to ' || to_char(NEW.end_date, 'DD Mon YYYY') || ' · ' || coalesce(NEW.days, 0) || ' days';

  if NEW.status = 'pending_manager' then
    perform public.queue_alert(NEW.tenant_id, 'leave_requested', 'Leave to approve: ' || coalesce(v_name, 'an employee'),
      v_span || coalesce(' · ' || NEW.reason, ''), '/me?tab=leave', array[NEW.manager_user_id], '{}', 'leave', NEW.id);
  elsif NEW.status = 'pending' then
    perform public.queue_alert(NEW.tenant_id, 'leave_requested', 'Leave request: ' || coalesce(v_name, 'an employee'),
      v_span || case when TG_OP = 'UPDATE' and OLD.status = 'pending_manager' then ' · approved by the line manager' else '' end || coalesce(' · ' || NEW.reason, ''),
      '/hrm/leave', '{}', array['admin', 'manager'], 'leave', NEW.id);
    if TG_OP = 'UPDATE' and OLD.status = 'pending_manager' then
      perform public.queue_alert(NEW.tenant_id, 'leave_decided', 'Your manager approved your leave',
        v_span || ' · now with HR', '/me?tab=leave', array[NEW.requested_by, v_emp_user], '{}', 'leave', NEW.id);
    end if;
  elsif NEW.status in ('approved', 'rejected') then
    perform public.queue_alert(NEW.tenant_id, 'leave_decided', 'Leave ' || NEW.status,
      to_char(NEW.start_date, 'DD Mon') || ' to ' || to_char(NEW.end_date, 'DD Mon YYYY') || coalesce(': ' || NEW.decision_note, ''),
      '/me?tab=leave', array[NEW.requested_by, v_emp_user], '{}', 'leave', NEW.id);
    if NEW.status = 'approved' and v_cover_user is not null then
      perform public.queue_alert(NEW.tenant_id, 'leave_decided', 'You are covering for ' || coalesce(v_name, 'a colleague'),
        v_span, '/me', array[v_cover_user], '{}', 'leave', NEW.id);
    end if;
  elsif NEW.status = 'cancelled' and TG_OP = 'UPDATE' and OLD.status = 'approved' and v_cover_user is not null then
    perform public.queue_alert(NEW.tenant_id, 'leave_decided', 'Cover no longer needed for ' || coalesce(v_name, 'a colleague'),
      v_span || ' · the leave was cancelled', '/me', array[v_cover_user], '{}', 'leave', NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists alert_leave on public.hr_leave_requests;
create trigger alert_leave after insert or update of status on public.hr_leave_requests for each row execute function public.alert_leave();

-- ── 5. Work from home ──────────────────────────────────────────────────────
create table if not exists public.hr_wfh_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days numeric not null default 1,
  reason text,
  status text not null default 'pending',
  manager_user_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  history jsonb not null default '[]'::jsonb,
  requested_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hr_wfh_requests drop constraint if exists hr_wfh_requests_status_check;
alter table public.hr_wfh_requests add constraint hr_wfh_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled'));
alter table public.hr_wfh_requests drop constraint if exists hr_wfh_requests_dates_check;
alter table public.hr_wfh_requests add constraint hr_wfh_requests_dates_check check (end_date >= start_date);
create index if not exists hr_wfh_requests_tenant_idx on public.hr_wfh_requests (tenant_id, start_date);
create index if not exists hr_wfh_requests_employee_idx on public.hr_wfh_requests (employee_id, start_date, end_date);
create index if not exists hr_wfh_requests_manager_idx on public.hr_wfh_requests (manager_user_id) where status = 'pending';

alter table public.hr_wfh_requests enable row level security;
grant select, insert, update, delete on public.hr_wfh_requests to authenticated;
drop policy if exists hr_wfh_requests_rw on public.hr_wfh_requests;
create policy hr_wfh_requests_rw on public.hr_wfh_requests for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.hr_can())
  with check (tenant_id = public.current_user_tenant_id() and public.hr_can());
drop policy if exists hr_wfh_self on public.hr_wfh_requests;
create policy hr_wfh_self on public.hr_wfh_requests for select to authenticated
  using (employee_id in (select id from public.hr_employees where user_id = auth.uid()));
drop policy if exists hr_wfh_manager_read on public.hr_wfh_requests;
create policy hr_wfh_manager_read on public.hr_wfh_requests for select to authenticated
  using (manager_user_id = auth.uid());

/** Creates a work-from-home request, or changes one that is waiting or rejected. HR or the line manager decides. */
create or replace function public.hr_wfh_save(p_id uuid default null, p_employee uuid default null, p_start date default null, p_end date default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  v_old public.hr_wfh_requests;
  v_emp public.hr_employees;
  v_days numeric; v_mgr uuid; v_id uuid;
begin
  if v_tenant is null or auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_id is not null then
    select * into v_old from public.hr_wfh_requests where id = p_id and tenant_id = v_tenant for update;
    if v_old.id is null then raise exception 'Request not found'; end if;
    if v_old.status not in ('pending', 'rejected') then raise exception 'Only a request that is waiting or rejected can be changed'; end if;
    p_employee := v_old.employee_id;
  end if;
  if p_employee is null then
    select id into p_employee from public.hr_employees where tenant_id = v_tenant and user_id = auth.uid() limit 1;
    if p_employee is null then raise exception 'Your login is not linked to an employee record. Ask HR to link it.'; end if;
  end if;
  select * into v_emp from public.hr_employees where id = p_employee and tenant_id = v_tenant;
  if v_emp.id is null then raise exception 'Employee not found'; end if;
  if v_emp.user_id is distinct from auth.uid() and not public.hr_can() then raise exception 'You can only ask for yourself'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Check the dates: the last day is before the first'; end if;
  v_days := public.hr_working_days(v_tenant, p_start, p_end);
  if v_days <= 0 then raise exception 'Those dates have no working days'; end if;
  if exists (select 1 from public.hr_wfh_requests w where w.employee_id = p_employee and w.id is distinct from p_id
             and w.status in ('pending', 'approved') and w.start_date <= p_end and w.end_date >= p_start) then
    raise exception 'Those dates overlap another work-from-home request';
  end if;
  if exists (select 1 from public.hr_leave_requests r where r.employee_id = p_employee
             and r.status in ('pending_manager', 'pending', 'approved') and r.start_date <= p_end and r.end_date >= p_start) then
    raise exception 'Those dates overlap your leave';
  end if;
  v_mgr := public.hr_line_manager_user(p_employee);

  if p_id is null then
    insert into public.hr_wfh_requests (tenant_id, employee_id, start_date, end_date, days, reason, status, manager_user_id, requested_by, history)
    values (v_tenant, p_employee, p_start, p_end, v_days, nullif(btrim(coalesce(p_reason, '')), ''), 'pending', v_mgr, auth.uid(),
      jsonb_build_array(public.hr_history_entry('requested')))
    returning id into v_id;
  else
    update public.hr_wfh_requests set start_date = p_start, end_date = p_end, days = v_days, reason = nullif(btrim(coalesce(p_reason, '')), ''),
      status = 'pending', manager_user_id = v_mgr, decided_by = null, decided_at = null, decision_note = null, updated_at = now(),
      history = coalesce(history, '[]'::jsonb) || public.hr_history_entry(case when v_old.status = 'rejected' then 'resubmitted' else 'edited' end)
    where id = p_id returning id into v_id;
  end if;

  perform public.queue_alert(v_tenant, 'leave_requested', 'Work from home: ' || concat_ws(' ', v_emp.first_name, v_emp.last_name),
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' to ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day' || case when v_days = 1 then '' else 's' end || coalesce(' · ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
    case when v_mgr is not null then '/me?tab=leave' else '/hrm/leave' end, array[v_mgr], array['admin', 'manager'], 'wfh', v_id);
  return v_id;
end $$;

/** Approves or rejects a work-from-home request (HR or the line manager). */
create or replace function public.hr_wfh_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  w public.hr_wfh_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_emp_user uuid;
  v_status text := case when coalesce(p_approve, false) then 'approved' else 'rejected' end;
begin
  select * into w from public.hr_wfh_requests where id = p_id and tenant_id = v_tenant for update;
  if w.id is null then raise exception 'Request not found'; end if;
  if w.status <> 'pending' then raise exception 'This request is already %', w.status; end if;
  if not public.hr_can() and w.manager_user_id is distinct from auth.uid() then raise exception 'Not allowed'; end if;
  select user_id into v_emp_user from public.hr_employees where id = w.employee_id;
  if v_emp_user = auth.uid() and not public.has_role(auth.uid(), 'admin') then raise exception 'Someone else must decide your own request'; end if;
  if v_status = 'rejected' and v_note is null then raise exception 'Say why it is rejected'; end if;
  update public.hr_wfh_requests set status = v_status, decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now(),
    history = coalesce(history, '[]'::jsonb) || public.hr_history_entry(v_status, v_note)
  where id = p_id;
  perform public.queue_alert(v_tenant, 'leave_decided', 'Work from home ' || v_status,
    to_char(w.start_date, 'DD Mon') || case when w.end_date <> w.start_date then ' to ' || to_char(w.end_date, 'DD Mon YYYY') else to_char(w.start_date, ' YYYY') end || coalesce(': ' || v_note, ''),
    '/me?tab=leave', array[w.requested_by, v_emp_user], '{}', 'wfh', w.id);
end $$;

/** Closes a work-from-home request that is waiting, rejected, or approved and not yet over. */
create or replace function public.hr_wfh_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  w public.hr_wfh_requests;
begin
  select * into w from public.hr_wfh_requests where id = p_id and tenant_id = v_tenant for update;
  if w.id is null then raise exception 'Request not found'; end if;
  if not public.hr_can() and not exists (select 1 from public.hr_employees e where e.id = w.employee_id and e.user_id = auth.uid()) then
    raise exception 'Not allowed';
  end if;
  if w.status = 'cancelled' then raise exception 'This request is already closed'; end if;
  if w.status = 'approved' and w.end_date < public.hr_today() then raise exception 'These days are already over'; end if;
  update public.hr_wfh_requests set status = 'cancelled', updated_at = now(),
    history = coalesce(history, '[]'::jsonb) || public.hr_history_entry('cancelled')
  where id = p_id;
end $$;

revoke all on function public.hr_wfh_save(uuid, uuid, date, date, text) from public, anon;
revoke all on function public.hr_wfh_decide(uuid, boolean, text) from public, anon;
revoke all on function public.hr_wfh_cancel(uuid) from public, anon;
grant execute on function public.hr_wfh_save(uuid, uuid, date, date, text) to authenticated;
grant execute on function public.hr_wfh_decide(uuid, boolean, text) to authenticated;
grant execute on function public.hr_wfh_cancel(uuid) to authenticated;

-- Live updates for the work-from-home list.
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.hr_wfh_requests'; exception when others then null; end;
end $$;

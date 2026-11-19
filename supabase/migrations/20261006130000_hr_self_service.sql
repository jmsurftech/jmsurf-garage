-- HR self-service: staff read holidays and departments, clock themselves in/out,
-- and read their own attendance.
drop policy if exists hr_holidays_read on public.hr_holidays;
create policy hr_holidays_read on public.hr_holidays for select to authenticated using (tenant_id = public.current_user_tenant_id());
drop policy if exists hr_departments_read on public.hr_departments;
create policy hr_departments_read on public.hr_departments for select to authenticated using (tenant_id = public.current_user_tenant_id());
drop policy if exists hr_designations_read on public.hr_designations;
create policy hr_designations_read on public.hr_designations for select to authenticated using (tenant_id = public.current_user_tenant_id());

drop policy if exists hr_attendance_self_read on public.hr_attendance;
create policy hr_attendance_self_read on public.hr_attendance for select to authenticated
  using (employee_id in (select id from public.hr_employees where user_id = auth.uid()));

/** Clock in or out for the signed-in employee (today, Nairobi time). */
create or replace function public.hr_clock(p_action text) returns public.hr_attendance
language plpgsql security definer set search_path = public as $$
declare e public.hr_employees; d date := (now() at time zone 'Africa/Nairobi')::date; t time := (now() at time zone 'Africa/Nairobi')::time; r public.hr_attendance; late boolean;
begin
  select * into e from public.hr_employees where user_id = auth.uid() and status not in ('terminated', 'resigned') limit 1;
  if not found then raise exception 'Your login is not linked to an employee record. Ask HR to link it.'; end if;
  late := t > time '08:30';
  if p_action = 'in' then
    insert into public.hr_attendance (tenant_id, employee_id, date, status, clock_in)
    values (e.tenant_id, e.id, d, case when late then 'late' else 'present' end, t)
    on conflict (employee_id, date) do update set clock_in = coalesce(public.hr_attendance.clock_in, excluded.clock_in),
      status = case when public.hr_attendance.status in ('absent', 'off') then excluded.status else public.hr_attendance.status end
    returning * into r;
  else
    update public.hr_attendance set clock_out = t,
      hours = round(extract(epoch from (t - coalesce(clock_in, t))) / 3600.0, 2),
      overtime_hours = greatest(0, round(extract(epoch from (t - coalesce(clock_in, t))) / 3600.0 - 9, 2))
     where employee_id = e.id and date = d returning * into r;
    if not found then raise exception 'Clock in first'; end if;
  end if;
  return r;
end $$;
grant execute on function public.hr_clock(text) to authenticated;

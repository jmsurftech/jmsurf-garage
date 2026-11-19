-- "See salaries and bank details" (employees.salary) is now enforced, as in Apex HRM: payslips, pay items and
-- payroll runs are only readable or changeable by people allowed to see pay. Admins always are; a user with a
-- company role needs the permission on that role; users without a company role keep the HR rule they had.
-- Everyone still sees their own payslips (hr_payslips_self).
create or replace function public.hr_can_see_pay()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin') or coalesce((
    select case when r.id is null then public.hr_can()
                else coalesce((r.permissions ->> 'employees.salary')::boolean, false) end
      from public.profiles p left join public.company_roles r on r.id = p.company_role_id
     where p.user_id = auth.uid() limit 1), false)
$$;
grant execute on function public.hr_can_see_pay() to authenticated;

alter policy hr_payslips_rw on public.hr_payslips using ((tenant_id = current_user_tenant_id()) and hr_can() and hr_can_see_pay())
  with check ((tenant_id = current_user_tenant_id()) and hr_can() and hr_can_see_pay());
alter policy hr_pay_items_rw on public.hr_pay_items using ((tenant_id = current_user_tenant_id()) and hr_can() and hr_can_see_pay())
  with check ((tenant_id = current_user_tenant_id()) and hr_can() and hr_can_see_pay());
alter policy hr_payroll_runs_rw on public.hr_payroll_runs using ((tenant_id = current_user_tenant_id()) and hr_can() and hr_can_see_pay())
  with check ((tenant_id = current_user_tenant_id()) and hr_can() and hr_can_see_pay());

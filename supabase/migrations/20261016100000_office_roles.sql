-- Office roles for companies that run on JMSURF BOOKS (Finance, Customer Service),
-- and more than one Admin per company. The owner's own admin role stays untouchable.
alter type public.app_role add value if not exists 'finance';
alter type public.app_role add value if not exists 'customer_service';

drop policy if exists "user_roles_manage" on public.user_roles;
create policy "user_roles_manage" on public.user_roles to authenticated
using (
  has_role(auth.uid(), 'super_admin'::app_role) or (
    has_role(auth.uid(), 'admin'::app_role)
    and user_id <> auth.uid()
    and role <> 'super_admin'::app_role
    and current_user_tenant_id() is not null
    and exists (select 1 from profiles p where p.user_id = user_roles.user_id and p.tenant_id = current_user_tenant_id())
    and not exists (select 1 from tenants t where t.id = current_user_tenant_id() and t.owner_user_id = user_roles.user_id)
  )
)
with check (
  has_role(auth.uid(), 'super_admin'::app_role) or (
    has_role(auth.uid(), 'admin'::app_role)
    and user_id <> auth.uid()
    and role <> 'super_admin'::app_role
    and current_user_tenant_id() is not null
    and exists (select 1 from profiles p where p.user_id = user_roles.user_id and p.tenant_id = current_user_tenant_id())
    and not exists (select 1 from tenants t where t.id = current_user_tenant_id() and t.owner_user_id = user_roles.user_id)
  )
);

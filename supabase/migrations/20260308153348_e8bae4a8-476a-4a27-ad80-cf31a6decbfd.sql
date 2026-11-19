
-- Allow tenant members (users whose profile.tenant_id matches) to SELECT their tenant
CREATE POLICY "tenants_member_select" ON public.tenants
FOR SELECT TO authenticated
USING (
  id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
);

-- Allow tenant members to SELECT subscriptions (not just owners)
CREATE POLICY "subs_member_select" ON public.subscriptions
FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
);

-- Allow tenant members to UPDATE subscriptions (for payment flows)
CREATE POLICY "subs_member_update" ON public.subscriptions
FOR UPDATE TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() AND tenant_id IS NOT NULL)
);

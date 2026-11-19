-- JMSURF DASH, part 2: catalogue for the website, customers and pets,
-- sales reps and commission, repurchase + debt reminders, targeted staff
-- notifications, integration secrets and the admin's active sessions.

-- ---------------------------------------------------------------- main branch
insert into public.locations (tenant_id, name, code, is_active, is_main)
select t.id, 'Main Shop', 'MAIN', true, true from public.tenants t
 where not exists (select 1 from public.locations l where l.tenant_id = t.id);

-- ---------------------------------------------------------------- catalogue (items + online shop)
alter table public.products
  add column if not exists description text,
  add column if not exists show_online boolean not null default true,
  add column if not exists featured boolean not null default false,
  add column if not exists images jsonb not null default '[]'::jsonb,          -- ["https://…", …] gallery
  add column if not exists specs jsonb not null default '[]'::jsonb,           -- [{label, value}] Alibaba-style attributes
  add column if not exists tier_prices jsonb not null default '[]'::jsonb,     -- [{min_qty, price}] volume pricing
  add column if not exists min_order_qty numeric not null default 1,
  add column if not exists repurchase_days integer,                            -- e.g. 90 for a dewormer
  add column if not exists weight_kg numeric,
  add column if not exists tags text[] not null default '{}',
  add column if not exists slug text;
create index if not exists products_online_idx on public.products (tenant_id, show_online, is_active);

alter table public.services
  add column if not exists show_online boolean not null default true,
  add column if not exists image_url text,
  add column if not exists duration_minutes integer,
  add column if not exists repurchase_days integer;

-- Anyone may browse the shop's online catalogue (prices, photos, stock levels);
-- cost prices stay private because the view leaves them out.
create or replace view public.shop_catalogue with (security_invoker = false) as
  select p.id, p.tenant_id, p.name, p.sku, p.category, p.subcategory, p.brand, p.price, p.unit, p.vat_rate,
         p.image_url, p.images, p.description, p.specs, p.tier_prices, p.min_order_qty, p.featured, p.tags,
         p.enable_wholesale, p.wholesale_price, p.wholesale_min_quantity, p.weight_kg, p.created_at, p.updated_at,
         greatest(coalesce((select sum(ps.stock) from public.product_stocks ps where ps.product_id = p.id), p.stock, 0), 0) as stock,
         'product'::text as kind
    from public.products p
   where p.is_active and p.show_online
  union all
  select s.id, s.tenant_id, s.name, null, s.category, null, null, s.price, null, s.vat_rate,
         s.image_url, case when s.image_url is null then '[]'::jsonb else jsonb_build_array(s.image_url) end, s.description,
         '[]'::jsonb, '[]'::jsonb, 1, false, '{}'::text[], false, null, null, null, s.created_at, s.updated_at,
         null::numeric, 'service'::text
    from public.services s
   where s.is_active and s.show_online;
grant select on public.shop_catalogue to anon, authenticated;

create or replace view public.shop_categories with (security_invoker = false) as
  select c.id, c.tenant_id, c.name, c.image_url, c.sort_order from public.product_categories c;
grant select on public.shop_categories to anon, authenticated;

-- ---------------------------------------------------------------- customers (contact fields) + pets
alter table public.customers
  add column if not exists customer_type text not null default 'individual',
  add column if not exists company_name text,
  add column if not exists kra_pin text,
  add column if not exists notes text,
  add column if not exists salesperson_id uuid,
  add column if not exists credit_days integer not null default 0,
  add column if not exists tags text[] not null default '{}',
  add column if not exists source text not null default 'manual',      -- manual | pos | shop | import
  add column if not exists first_purchase_at timestamptz,
  add column if not exists last_purchase_at timestamptz;

create table if not exists public.customer_pets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  species text,          -- dog, cat, bird, fish …
  breed text,
  sex text,
  birth_date date,
  weight_kg numeric,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists customer_pets_customer_idx on public.customer_pets (customer_id);

-- ---------------------------------------------------------------- sales reps + commission
alter table public.transactions
  add column if not exists sales_rep_id uuid,
  add column if not exists sales_rep_name text,
  add column if not exists due_date date,
  add column if not exists invoice_id uuid;
create index if not exists transactions_rep_idx on public.transactions (tenant_id, sales_rep_id, created_at);

create table if not exists public.sales_reps (
  user_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  display_name text not null,
  phone text,
  email text,
  default_commission_pct numeric not null default 0 check (default_commission_pct between 0 and 100),
  monthly_target numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rep_id uuid,             -- null = every rep
  category text,           -- null = every category
  pct numeric not null check (pct between 0 and 100),
  created_at timestamptz not null default now()
);
create table if not exists public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rep_id uuid not null,
  period_start date not null,
  period_end date not null,
  amount numeric not null check (amount >= 0),
  method text,
  reference text,
  paid_by uuid,
  paid_at timestamptz not null default now(),
  notes text
);

-- ---------------------------------------------------------------- reminders (repurchase + debts)
create table if not exists public.customer_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  pet_id uuid references public.customer_pets(id) on delete set null,
  kind text not null default 'repurchase',      -- repurchase | debt | custom
  product_id uuid,
  product_name text,
  invoice_id uuid references public.invoices(id) on delete cascade,
  transaction_id uuid,
  due_date date not null,
  title text,
  status text not null default 'scheduled',      -- scheduled | sent | done | dismissed
  sales_rep_id uuid,
  notified_at timestamptz,
  results jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_reminders_due_idx on public.customer_reminders (tenant_id, status, due_date);
create index if not exists customer_reminders_customer_idx on public.customer_reminders (customer_id);
create unique index if not exists customer_reminders_repurchase_once
  on public.customer_reminders (transaction_id, product_id) where kind = 'repurchase' and transaction_id is not null;

create table if not exists public.debt_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  stage text not null,                 -- e.g. -3, 0, 7 (days relative to due date)
  channel text not null,               -- sms | email | whatsapp | inapp
  recipient text,
  status text not null default 'sent',
  detail text,
  created_at timestamptz not null default now(),
  unique (invoice_id, stage, channel, recipient)
);

-- ---------------------------------------------------------------- targeted staff notifications
alter table public.shop_notifications
  add column if not exists user_id uuid,           -- null = whole team
  add column if not exists role text,              -- null = any role
  add column if not exists entity_type text,
  add column if not exists entity_id uuid;
create index if not exists shop_notifications_user_idx on public.shop_notifications (tenant_id, user_id, created_at desc);

-- ---------------------------------------------------------------- integration secrets (server only)
create table if not exists public.integration_secrets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,                 -- jmsurf_sms_key | jmsurf_pay_key | …
  value text not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, name)
);
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from anon, authenticated;
-- Owners save a key without ever reading it back.
create or replace function public.set_integration_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id();
begin
  if t is null or not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then raise exception 'Not allowed'; end if;
  if p_name !~ '^[a-z0-9_]{3,40}$' then raise exception 'Bad key name'; end if;
  if coalesce(trim(p_value), '') = '' then
    delete from public.integration_secrets where tenant_id = t and name = p_name;
  else
    insert into public.integration_secrets (tenant_id, name, value, updated_by, updated_at) values (t, p_name, trim(p_value), auth.uid(), now())
      on conflict (tenant_id, name) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  end if;
end $$;
create or replace function public.integration_secret_status() returns table (name text, is_set boolean, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select s.name, true, s.updated_at from public.integration_secrets s where s.tenant_id = public.current_user_tenant_id()
$$;
revoke all on function public.set_integration_secret(text, text) from public, anon;
revoke all on function public.integration_secret_status() from public, anon;
grant execute on function public.set_integration_secret(text, text) to authenticated;
grant execute on function public.integration_secret_status() to authenticated;

-- ---------------------------------------------------------------- active sessions (owner / admins only)
create or replace function public.team_active_sessions()
returns table (session_id uuid, user_id uuid, display_name text, role text, created_at timestamptz, refreshed_at timestamptz,
               user_agent text, ip text, aal text, is_current boolean)
language plpgsql security definer set search_path = public, auth as $$
declare t uuid := public.current_user_tenant_id();
begin
  if t is null or not public.has_role(auth.uid(), 'admin') then raise exception 'Only the owner can see sign-ins'; end if;
  return query
    select s.id, s.user_id, p.display_name, (select r.role::text from public.user_roles r where r.user_id = s.user_id limit 1),
           s.created_at, coalesce(s.refreshed_at, s.updated_at, s.created_at), s.user_agent, host(s.ip)::text, s.aal::text,
           s.id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid
      from auth.sessions s
      join public.profiles p on p.user_id = s.user_id and p.tenant_id = t
     where (s.not_after is null or s.not_after > now())
     order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc;
end $$;
create or replace function public.team_end_session(p_session uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare t uuid := public.current_user_tenant_id();
begin
  if t is null or not public.has_role(auth.uid(), 'admin') then raise exception 'Only the owner can sign people out'; end if;
  delete from auth.sessions s using public.profiles p
   where s.id = p_session and p.user_id = s.user_id and p.tenant_id = t;
end $$;
revoke all on function public.team_active_sessions() from public, anon;
revoke all on function public.team_end_session(uuid) from public, anon;
grant execute on function public.team_active_sessions() to authenticated;
grant execute on function public.team_end_session(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS for the new tenant tables
do $$ declare t text; begin
  foreach t in array array['customer_pets', 'sales_reps', 'commission_rules', 'commission_payouts', 'customer_reminders', 'debt_alerts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = public.current_user_tenant_id())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- Staff may keep pets and reminders up to date; money and commission rules are for owner/managers.
create policy customer_pets_write on public.customer_pets for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
create policy customer_reminders_write on public.customer_reminders for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
create policy debt_alerts_write on public.debt_alerts for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id());
do $$ declare t text; begin
  foreach t in array array['sales_reps', 'commission_rules', 'commission_payouts'] loop
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), ''admin'') or public.has_role(auth.uid(), ''manager''))) with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), ''admin'') or public.has_role(auth.uid(), ''manager'')))', t || '_write', t);
  end loop;
end $$;

alter publication supabase_realtime add table public.customer_reminders;

-- 2026-10-05: preferred vendor on items
alter table public.products add column if not exists preferred_supplier_id uuid references public.suppliers(id) on delete set null;

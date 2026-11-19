-- Launch prices: Starter 1,000, Standard 2,500, Professional 5,000, All-in-One 15,000 a month.
-- Quarterly is 5% off three months; yearly is ten months (two free).
update public.plans p set price_monthly = v.m, price_quarterly = v.q, price_annually = v.y
from (values ('Starter', 1000, 2850, 10000), ('Standard', 2500, 7125, 25000), ('Professional', 5000, 14250, 50000), ('All-in-One', 15000, 42750, 150000)) v(name, m, q, y)
where p.name = v.name and p.is_active;

-- Companies still on a free trial (nothing paid yet) start at the new price.
update public.subscriptions s
set price = case s.billing_cycle when 'quarterly' then p.price_quarterly when 'annually' then p.price_annually when 'yearly' then p.price_annually else p.price_monthly end
from public.plans p
where s.status = 'trialing' and p.is_active and p.name = s.plan_name and coalesce(s.price, 0) > 0;

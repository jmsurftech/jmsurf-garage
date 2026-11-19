-- 2026-10-02: tenant_feature_overrides held full snapshots of every switch,
-- freezing shops at whatever their package was when an admin last saved.
-- Keep only real differences from each shop's current package (what shops
-- see is unchanged), and clear Vellora's leftover "off" switches from an old
-- snapshot so it gets its whole Standard package as the admin intended.
WITH cur AS (
  SELECT o.tenant_id, o.features AS ov,
    coalesce((SELECT p.features FROM subscriptions s JOIN plans p ON p.id = s.plan_id
              WHERE s.tenant_id = o.tenant_id ORDER BY s.created_at DESC LIMIT 1),
             (SELECT features FROM plans WHERE is_active ORDER BY price_monthly LIMIT 1)) AS pf
  FROM tenant_feature_overrides o
)
UPDATE tenant_feature_overrides o
   SET features = (SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(cur.ov) e(k, v)
                    WHERE jsonb_typeof(v) = 'boolean' AND v <> coalesce(cur.pf -> k, 'true'::jsonb))
  FROM cur WHERE cur.tenant_id = o.tenant_id;

UPDATE tenant_feature_overrides SET features = '{}'::jsonb
 WHERE tenant_id = (SELECT id FROM tenants WHERE business_name = 'VELLORA DENTAL SOLUTIONS');

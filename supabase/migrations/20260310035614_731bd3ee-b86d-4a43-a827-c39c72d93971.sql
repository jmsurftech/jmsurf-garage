
-- Drop unique constraints on locations (should not be unique across tenants)
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_name_key;
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_code_key;

-- Clean up orphaned business_settings with null tenant_id
DELETE FROM business_settings WHERE tenant_id IS NULL;

-- Create business_settings for jmsurf tenant
INSERT INTO business_settings (tenant_id, business_name, business_email, business_phone)
SELECT '50bd2de7-b7d6-4782-bf78-00f8d63c0d6f', 'JMSURF POS', 'hello@jmsurfpos.co.ke', '0712504593'
WHERE NOT EXISTS (
  SELECT 1 FROM business_settings WHERE tenant_id = '50bd2de7-b7d6-4782-bf78-00f8d63c0d6f'
);

-- Clean up orphaned locations
DELETE FROM locations WHERE tenant_id IS NULL;

-- Ensure jmsurf has a location
INSERT INTO locations (name, code, tenant_id)
SELECT 'Main Store', 'MAIN', '50bd2de7-b7d6-4782-bf78-00f8d63c0d6f'
WHERE NOT EXISTS (
  SELECT 1 FROM locations WHERE tenant_id = '50bd2de7-b7d6-4782-bf78-00f8d63c0d6f'
);

-- Clean up orphaned inventory_settings
DELETE FROM inventory_settings WHERE tenant_id IS NULL;

-- Ensure jmsurf inventory settings exist
INSERT INTO inventory_settings (tenant_id)
SELECT '50bd2de7-b7d6-4782-bf78-00f8d63c0d6f'
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_settings WHERE tenant_id = '50bd2de7-b7d6-4782-bf78-00f8d63c0d6f'
);

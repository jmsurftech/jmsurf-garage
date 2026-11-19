
UPDATE plans SET features = features || jsonb_build_object(
  'offline_pos', true, 'mpesa_stk', true, 'loyalty_points', true,
  'split_payments', true, 'customer_display', true, 'thermal_printing', true
) WHERE name = 'Starter';

UPDATE plans SET features = features || jsonb_build_object(
  'offline_pos', true, 'mpesa_stk', true, 'loyalty_points', true,
  'split_payments', true, 'customer_display', true, 'thermal_printing', true,
  'delivery_notes', true, 'packing_lists', true, 'recurring_billing', true,
  'audit_log', true, 'payhero_bank_settlement', true, 'product_images', true
) WHERE name = 'Growth';

UPDATE plans SET features = features || jsonb_build_object(
  'offline_pos', true, 'mpesa_stk', true, 'loyalty_points', true,
  'split_payments', true, 'customer_display', true, 'thermal_printing', true,
  'delivery_notes', true, 'packing_lists', true, 'recurring_billing', true,
  'audit_log', true, 'payhero_bank_settlement', true, 'product_images', true,
  'custom_domain', true, 'multi_location', true, 'advanced_analytics', true,
  'priority_support', true
) WHERE name = 'Business';

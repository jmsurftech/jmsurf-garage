-- Add use_platform_mpesa toggle so tenants can opt into using JMSURF's M-Pesa API credentials
ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS use_platform_mpesa boolean NOT NULL DEFAULT false;

-- Seed platform M-Pesa credentials (Till) used as fallback for tenants who opt in.
-- These are the JMSURF master keys; tenants still provide their own paybill/till + shortcode.
INSERT INTO public.platform_settings (key, value)
VALUES (
  'payment',
  jsonb_build_object(
    'mpesa', jsonb_build_object(
      'enabled', true,
      'environment', 'live',
      'transaction_type', 'CustomerBuyGoodsOnline',
      'consumer_key', 'wSnVI9NChi2LrX1Q1B44Hrv5ZFMA9ZTU',
      'consumer_secret', 'H3FvEscmTdyLbJQZ',
      'passkey', '9dc9fc69c16e292e2e8ee5d440dc5ade183f0a2da56b7232868f6a46f775ab08',
      'shortcode', '7849385',
      'till_number', '7849385'
    )
  )
)
ON CONFLICT (key) DO UPDATE
SET value = jsonb_set(
  COALESCE(public.platform_settings.value, '{}'::jsonb),
  '{mpesa}',
  COALESCE(public.platform_settings.value->'mpesa', '{}'::jsonb) || jsonb_build_object(
    'enabled', true,
    'environment', 'live',
    'transaction_type', 'CustomerBuyGoodsOnline',
    'consumer_key', 'wSnVI9NChi2LrX1Q1B44Hrv5ZFMA9ZTU',
    'consumer_secret', 'H3FvEscmTdyLbJQZ',
    'passkey', '9dc9fc69c16e292e2e8ee5d440dc5ade183f0a2da56b7232868f6a46f775ab08',
    'shortcode', '7849385',
    'till_number', '7849385'
  ),
  true
),
updated_at = now();
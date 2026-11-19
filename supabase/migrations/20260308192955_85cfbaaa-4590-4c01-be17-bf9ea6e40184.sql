-- Add SMTP columns to business_settings
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS smtp_host text DEFAULT '',
  ADD COLUMN IF NOT EXISTS smtp_port text DEFAULT '587',
  ADD COLUMN IF NOT EXISTS smtp_username text DEFAULT '',
  ADD COLUMN IF NOT EXISTS smtp_password text DEFAULT '',
  ADD COLUMN IF NOT EXISTS smtp_from_email text DEFAULT '',
  ADD COLUMN IF NOT EXISTS smtp_from_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS smtp_encryption text DEFAULT 'tls',
  ADD COLUMN IF NOT EXISTS barcode_format text DEFAULT 'CODE128',
  ADD COLUMN IF NOT EXISTS barcode_label_width text DEFAULT '50mm',
  ADD COLUMN IF NOT EXISTS barcode_label_height text DEFAULT '30mm',
  ADD COLUMN IF NOT EXISTS barcode_show_price boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS barcode_show_name boolean DEFAULT true;
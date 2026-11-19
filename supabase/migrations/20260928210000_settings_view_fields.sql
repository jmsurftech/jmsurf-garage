-- Restores fields the shop settings view lost when it was last rebuilt:
-- the "use the JMSURF email / M-Pesa" switches (the SMTP test refused to run
-- because the switch always read as off), the STK label, the public Paystack
-- key, session settings and yes/no flags for saved secrets. Secrets themselves
-- stay hidden.
CREATE OR REPLACE VIEW public.business_settings_safe WITH (security_barrier = true, security_invoker = false) AS
SELECT bs.id,
    bs.tenant_id,
    bs.business_name,
    bs.business_email,
    bs.business_phone,
    bs.business_address,
    bs.tax_pin,
    bs.receipt_header,
    bs.receipt_footer,
    bs.default_vat_rate,
    bs.daily_sales_target,
    bs.payment_provider,
    bs.mpesa_environment,
    bs.mpesa_shortcode,
    bs.mpesa_till_number,
    bs.mpesa_transaction_type,
    bs.mpesa_account_reference,
    bs.barcode_format,
    bs.barcode_label_width,
    bs.barcode_label_height,
    bs.barcode_show_name,
    bs.barcode_show_price,
        CASE
            WHEN m.manager THEN bs.smtp_host
            ELSE NULL::text
        END AS smtp_host,
        CASE
            WHEN m.manager THEN bs.smtp_port
            ELSE NULL::text
        END AS smtp_port,
        CASE
            WHEN m.manager THEN bs.smtp_username
            ELSE NULL::text
        END AS smtp_username,
        CASE
            WHEN m.manager THEN bs.smtp_from_email
            ELSE NULL::text
        END AS smtp_from_email,
        CASE
            WHEN m.manager THEN bs.smtp_from_name
            ELSE NULL::text
        END AS smtp_from_name,
        CASE
            WHEN m.manager THEN bs.smtp_encryption
            ELSE NULL::text
        END AS smtp_encryption,
    bs.created_at,
    bs.updated_at,
    bs.updated_by,
        CASE bs.payment_provider
            WHEN 'jmsurf'::text THEN (EXISTS ( SELECT 1
               FROM sendmoney_tenants st
              WHERE st.tenant_id = bs.tenant_id))
            WHEN 'mpesa'::text THEN m.payhero_channel OR COALESCE(NULLIF(bs.mpesa_till_number, ''::text), bs.mpesa_shortcode, ''::text) ~ '^[0-9]{5,7}$'::text
            WHEN 'payhero'::text THEN m.payhero_channel OR COALESCE(NULLIF(bs.mpesa_till_number, ''::text), bs.mpesa_shortcode, ''::text) ~ '^[0-9]{5,7}$'::text
            WHEN 'bank'::text THEN m.payhero_channel
            WHEN 'daraja'::text THEN COALESCE(bs.mpesa_consumer_key, ''::text) <> ''::text AND COALESCE(bs.mpesa_consumer_secret, ''::text) <> ''::text AND COALESCE(bs.mpesa_passkey, ''::text) <> ''::text AND COALESCE(bs.mpesa_shortcode, ''::text) <> ''::text
            WHEN 'paystack'::text THEN COALESCE(bs.paystack_secret_key, ''::text) <> ''::text
            ELSE false
        END AS mpesa_ready,
    bs.currency,
    bs.use_platform_smtp,
    bs.use_platform_mpesa,
    bs.stk_label_mode,
    bs.stk_label_override,
    bs.paystack_public_key,
    bs.idle_timeout_minutes,
    bs.session_warning_seconds,
    bs.daily_logout_time,
    COALESCE(bs.mpesa_consumer_key, ''::text) <> ''::text AS has_mpesa_consumer_key,
    COALESCE(bs.mpesa_consumer_secret, ''::text) <> ''::text AS has_mpesa_consumer_secret,
    COALESCE(bs.mpesa_passkey, ''::text) <> ''::text AS has_mpesa_passkey,
    COALESCE(bs.paystack_secret_key, ''::text) <> ''::text AS has_paystack_secret_key,
    COALESCE(bs.smtp_password, ''::text) <> ''::text AS has_smtp_password
   FROM business_settings bs
     CROSS JOIN LATERAL ( SELECT has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role) AS manager,
            (EXISTS ( SELECT 1
                   FROM tenant_payout_channels c
                  WHERE c.tenant_id = bs.tenant_id AND c.is_active AND c.payhero_channel_id IS NOT NULL)) AS payhero_channel) m
  WHERE auth.uid() IS NOT NULL AND (bs.tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

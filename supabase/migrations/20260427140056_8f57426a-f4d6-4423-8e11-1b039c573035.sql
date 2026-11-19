UPDATE public.business_settings
SET mpesa_till_number = '4579120',
    mpesa_shortcode = '7849385',
    mpesa_transaction_type = 'CustomerBuyGoodsOnline',
    use_platform_mpesa = false
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'azil');
-- Was-price for offers ("List price" on the old website) and the
-- online catalogue exposing it, so the website and customer portal can show
-- products on offer.
alter table public.products add column if not exists compare_at_price numeric(12,2);

create or replace view public.shop_catalogue as
 SELECT p.id, p.tenant_id, p.name, p.sku, p.category, p.subcategory, p.brand, p.price, p.unit, p.vat_rate,
    p.image_url, p.images, p.description, p.specs, p.tier_prices, p.min_order_qty, p.featured, p.tags,
    p.enable_wholesale, p.wholesale_price, p.wholesale_min_quantity, p.weight_kg, p.created_at, p.updated_at,
    GREATEST(COALESCE((SELECT sum(ps.stock) FROM product_stocks ps WHERE ps.product_id = p.id), p.stock, 0::numeric), 0::numeric) AS stock,
    'product'::text AS kind,
    CASE WHEN p.compare_at_price > p.price THEN p.compare_at_price END AS compare_at_price
   FROM products p
  WHERE p.is_active AND p.show_online
UNION ALL
 SELECT s.id, s.tenant_id, s.name, NULL::text, s.category, NULL::text, NULL::text, s.price, NULL::text, s.vat_rate,
    s.image_url, CASE WHEN s.image_url IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(s.image_url) END,
    s.description, '[]'::jsonb, '[]'::jsonb, 1, false, '{}'::text[], false, NULL::numeric, NULL::integer, NULL::numeric,
    s.created_at, s.updated_at, NULL::numeric, 'service'::text, NULL::numeric
   FROM services s
  WHERE s.is_active AND s.show_online;

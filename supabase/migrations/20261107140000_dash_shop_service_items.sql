-- Online shop: items of type Service (Products & Services) show under Services and
-- are never "sold out" (they have no stock). They were all labelled products.
create or replace view public.shop_catalogue as
SELECT p.id,
    p.tenant_id,
    p.name,
    p.sku,
    p.category,
    p.subcategory,
    p.brand,
    p.price,
    p.unit,
    p.vat_rate,
    p.image_url,
    p.images,
    p.description,
    p.specs,
    p.tier_prices,
    p.min_order_qty,
    p.featured,
    p.tags,
    p.enable_wholesale,
    p.wholesale_price,
    p.wholesale_min_quantity,
    p.weight_kg,
    p.created_at,
    p.updated_at,
    CASE WHEN p.product_type = 'service' THEN NULL::numeric ELSE GREATEST(COALESCE(( SELECT sum(ps.stock) AS sum
           FROM product_stocks ps
          WHERE (ps.product_id = p.id)), p.stock, (0)::numeric), (0)::numeric) END AS stock,
    CASE WHEN p.product_type = 'service' THEN 'service'::text ELSE 'product'::text END AS kind,
        CASE
            WHEN (p.compare_at_price > p.price) THEN p.compare_at_price
            ELSE NULL::numeric
        END AS compare_at_price
   FROM products p
  WHERE (p.is_active AND p.show_online)
UNION ALL
 SELECT s.id,
    s.tenant_id,
    s.name,
    NULL::text AS sku,
    s.category,
    NULL::text AS subcategory,
    NULL::text AS brand,
    s.price,
    NULL::text AS unit,
    s.vat_rate,
    s.image_url,
        CASE
            WHEN (s.image_url IS NULL) THEN '[]'::jsonb
            ELSE jsonb_build_array(s.image_url)
        END AS images,
    s.description,
    '[]'::jsonb AS specs,
    '[]'::jsonb AS tier_prices,
    1 AS min_order_qty,
    false AS featured,
    '{}'::text[] AS tags,
    false AS enable_wholesale,
    NULL::numeric AS wholesale_price,
    NULL::integer AS wholesale_min_quantity,
    NULL::numeric AS weight_kg,
    s.created_at,
    s.updated_at,
    NULL::numeric AS stock,
    'service'::text AS kind,
    NULL::numeric AS compare_at_price
   FROM services s
  WHERE (s.is_active AND s.show_online);

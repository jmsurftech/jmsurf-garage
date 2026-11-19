-- Item codes (SKU) are unique within a company, not across every company on the platform.
alter table public.products drop constraint if exists products_sku_key;
create unique index if not exists products_tenant_sku_key on public.products (tenant_id, sku) where sku is not null and sku <> '';

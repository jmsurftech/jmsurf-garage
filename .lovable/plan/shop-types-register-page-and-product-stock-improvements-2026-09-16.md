# Shop types, register page and product/stock improvements

A set of changes across sign-up, settings, products, purchases, the counter and the admin panel.

## 1. Change shop type after sign-up
Add a "Shop type" card in Settings (Business section) where the owner picks General Retail, Liquor Store or Clothe Line. Saving updates the shop record and immediately switches the menus, counter screen and product forms. A short warning explains that switching hides type-specific screens (open bills, sizes and colours) but never deletes data.

## 2. Register page rebuilt
- Only three choices: General Retail, Clothe Line, Liquor Store. The long industry list and the "Select Your Industry" step are removed; the industry is set automatically from the choice.
- The taglines under each choice and the "This sets up your counter..." line are removed.
- Light, modern look: white/soft-neutral background, clean card, clear step markers, larger typography, orange accent kept for brand consistency.
- The verification note becomes plain text with no symbol: "After clicking Create Account, check your email inbox and spam folder for a verification link. You must verify your email before signing in."

## 3. Remove emojis system-wide
Sweep all pages, forms and toast messages and strip emoji and symbol characters (celebration, envelope, tick/cross marks, warning signs), replacing them with plain words or existing line icons.

## 4. Clothe Line product form simplified
When the shop type is Clothe Line the add/edit product form only shows what matters: name, category, product type, and the size/colour grid. Liquor and general-only fields are hidden. The grid gets faster entry: pick sizes and colours, then fill quantity and price per combination, with "apply price to all" and "apply quantity to all" shortcuts.

## 5. Product detail view with breakdown
Opening a clothing product shows the full size/colour/price/stock breakdown on the product page itself (with an Edit button at the top right) instead of a separate tab. The separate "Sizes & colours" sidebar entry is removed for clothing shops.

## 6. Stock adjustment asks for size and colour
Adjusting stock on a sized or sized-and-coloured product first asks which size and colour, then applies the change to that exact combination.

## 7. Purchases handle sizes and colours
When adding a sized or sized-and-coloured product to a purchase, the line asks for size, colour, quantity and cost price, and received stock lands on the right combination.

## 8. Instant M-Pesa prompt
The payment prompt currently waits for a fixed delay before the first status check. The request is sent immediately on click and the waiting screen appears at once, with status polling starting in the background.

## 9. Admin can disable modules; slimmer default for new shops
The admin panel already has per-shop module switches; it gains the newer modules and a clearer layout. New shops created from now on start with only Dashboard, Point of Sale, Inventory, Purchases, Reports, Billing, Staff and Settings visible; everything else is off until the admin turns it on. Existing shops are unaffected.

## 10. One dropdown open at a time
Dropdowns register with a small shared controller so opening one closes any other that is open.

## Technical notes
- `tenants.business_type` already exists; the settings card writes to it and invalidates the tenant/business-type queries so navigation and POS re-render without reload.
- New-tenant defaults are applied through `tenant_feature_overrides` at signup (in `handle_new_user`), keeping plan-level flags untouched. `ALL_FEATURES` in `useTenantFeatures.ts` gains any missing module keys.
- Product breakdown reuses `useVariantsByProduct`; the clothing variant route is dropped from `BUSINESS_TYPE_CONFIG.extraNav`.
- Purchase and stock-adjustment lines write `variant_id` on `purchase_items` / `stock_adjustments` (columns already nullable).
- Dropdown coordination via a lightweight context wrapping Radix `open`/`onOpenChange` in the shared select/dropdown components.

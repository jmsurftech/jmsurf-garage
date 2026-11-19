# Vendor-Specific POS: Liquor Store and Clothe Line

Two tailored shop experiences, picked at registration. The shop type decides which dashboard, sales screen, product form and reports the owner sees. Settings (payment gateways, SMTP, themes, sessions, staff/roles) stay identical for everyone.

Deferred, not dropped: the VPS self-hosting kit from the previous plan — we can return to it after this.

## 1. Choosing the shop type

- Registration step 2 becomes "What kind of shop is this?" with three clear cards: **Liquor Store**, **Clothe Line (uniforms, clothing & shoes)**, **General Retail** (today's behaviour).
- The choice is saved on the business and drives the whole app. Owners can change it later in Settings > Business (with a warning that some screens change).
- Existing shops stay on General Retail, so nothing breaks for current users.

## 2. Liquor Store

Built around the Kenyan bar/wines-and-spirits way of working: write up the order, print a bill, take it to the customer, collect money, then print the receipt and close the bill.

- **Open bills / tabs.** Start a bill for a table, room or customer name; keep adding items; leave it open and switch between several open bills. Bills survive a page refresh.
- **Print bill (pro-forma)** — clearly marked "BILL — NOT A RECEIPT", then **collect payment** by M-Pesa prompt, cash (with change calculation) or card, then **print receipt** and the bill is marked Paid.
- **Split and part payments** on one bill (e.g. part cash, part M-Pesa), plus "pay later / on credit" for known customers with a running balance.
- **Product setup for liquor**: brand, category (beer, spirits, wines, RTD, soft drinks, cigarettes), bottle size (250ml/500ml/750ml/1L), and **two prices per item — full bottle and per tot/glass**, with tots-per-bottle so selling a tot deducts the right fraction of a bottle.
- **Crates and returnable empties**: crate/bottle deposit tracking, returns of empties, and stock counted in both crates and single bottles.
- **Happy hour / wholesale price** toggle already in the app, kept and surfaced per item.
- **Shift and cash-up**: opening float, sales by payment method, expected vs counted cash, variance — printable at shift close.
- **Fast-selling grid** with big tiles by category, barcode scan, and a "quick add" for the top 20 movers.
- **Age-restriction notice** on the receipt and an 18+ confirmation prompt, plus licence/permit details on printouts.
- **Dashboard**: today's sales by payment method, open bills and their value, tots vs bottles sold, top brands, low stock by brand, empties owed, shift status.

## 3. Clothe Line (school uniforms, clothing, shoes)

Everything hangs off **variants**, because the same shirt exists in many sizes and colours.

- **Product types when adding an item:**
  - *Sized & coloured* (shirts, dresses, sweaters): pick sizes (S, M, L, XL, XXL, XXXL or numeric school sizes 2-24) and colours (Red, White, Black, Navy…). The app builds the size x colour grid and you type quantity and price into each cell.
  - *Sized only* (shoes: 28, 40, 42, 45…): one row per size with quantity and price; colour optional and, if used, becomes a second column.
  - *Standard* (ties, badges, socks): a single "Standard" option — quantity and price, nothing else.
  - *Simple* (pens, bags, books): today's plain product with one quantity and one price.
- **Price per variant** — a size XXXL sweater can cost more than an S, and each variant has its own stock.
- **Bulk grid entry**: paste or tab through the whole size/colour grid at once instead of creating dozens of products.
- **School / brand grouping**: tag items to a school (e.g. "St. Mary's Primary") so a parent's order can be filtered to one school's uniform set, and "uniform sets" can be sold as a bundle (shirt + short + sweater + tie) at a set price.
- **Selling**: pick the product, then the size/colour chip; out-of-stock chips are greyed out. Cart lines show "Shirt - White / M".
- **Exchanges and returns** — the everyday uniform problem: swap a size, with stock moving between variants and a printed exchange note.
- **Layaway / school order deposit**: take a deposit, keep the balance owing, collect on pickup.
- **Dashboard**: sales by school, best-selling sizes and colours, size gaps (sizes that are out of stock), items to reorder, pending exchanges and layaways.

## 4. Every other module follows the shop type

Anywhere an item is listed, the line now carries the same detail as the sale:

- **Purchase orders and supplier bills**: ordering shirts means picking size and colour per line ("Shirt - White - M x 40"), and receiving the order adds stock to those exact variants. For liquor, PO lines are in crates or bottles with bottle size and cost per crate, and receiving converts crates to bottles automatically.
- **Invoices and quotes**: line items show size/colour or bottle size and tot/bottle, and the printed document matches. Uniform bundles print as a set with the individual pieces underneath.
- **Delivery notes and packing lists**: picking lists are grouped by size/colour so staff can pack a school order accurately; liquor notes show crates plus loose bottles and returnable empties expected back.
- **Stock transfers and stock adjustments**: move or correct stock at the variant level (or crate/bottle level) rather than the whole product.
- **Returns and exchanges** flow back into the same documents, so a swapped size corrects both stock and paperwork.
- **Reports**: sales by size/colour/school for the clothes shop; sales by brand, bottle vs tot, crates and empties for the liquor shop. Existing reports keep working for General Retail.
- **Receipts and customer-facing prints** show the same wording as the cart line.

## 5. What is shared vs tuned

- **Unchanged for all types**: Settings (payment gateways, M-Pesa, SMTP/email, themes, session, staff, roles, tenant domains), billing, receipts infrastructure, offline mode, audit log.
- **Tuned per type**: dashboard cards, POS screen, product add/edit form, inventory list columns, purchase/invoice/delivery/packing line editors, reports set, and the menu (a liquor shop sees Bills/Tabs and Shift Cash-up; a clothe line sees Variants, Exchanges and Layaway).
- **General Retail** keeps exactly what exists today.


## Technical notes

- New `business_type` column on `tenants` (`general` | `liquor` | `clothing`), written from registration metadata and readable through the existing tenant hook; a small `useBusinessType()` hook plus a `BUSINESS_TYPE_CONFIG` map drives nav, dashboard and POS variants.
- New tables: `product_variants` (product_id, size, color, sku, price, cost, stock per location, barcode), `open_bills` + `open_bill_items` for liquor tabs, `bill_payments` for part/split settlement, `product_bundles` for uniform sets, `variant_exchanges`, `layaways`. Each follows the standard tenant-scoped RLS + GRANT pattern.
- `product_stocks` gains an optional `variant_id` so stock, adjustments and transfers work per variant; existing rows keep `variant_id` null.
- Liquor tot selling stores `unit_type` (`bottle` | `tot`) and `tots_per_bottle` on products; a sale of a tot deducts `1/tots_per_bottle`. Crate handling stores `units_per_crate` and a deposit amount.
- A shared `variant_id` (nullable) is added to every line-carrying structure — `purchase_items`, invoice/quote/delivery-note/packing-list item JSON, `stock_adjustments`, transfers and transaction items — so one line renderer (`<ItemLineLabel>`) formats "Shirt - White / M" or "Tusker 500ml - tot" everywhere.
- A shared `ItemPicker` component replaces the per-module product pickers so PO, invoice, quote, delivery note and packing list all get variant/bottle selection with the same behaviour.
- Receiving a purchase order writes stock to `product_stocks` keyed by product + variant + location, with crate-to-bottle conversion applied for liquor.
- POS is split into `PointOfSaleGeneral`, `PointOfSaleLiquor`, `PointOfSaleClothing` sharing the existing cart/payment/receipt logic, chosen by business type at the route level so bundle size stays lazy-loaded.
- Nav filtering reuses `NAV_PERMISSION_MAP`/`NAV_FEATURE_MAP` with an added business-type filter, so staff permissions and feature flags keep working.
- Build order: schema + business type on registration -> shared variant line/picker -> Clothe Line variants, POS and documents -> Liquor bills/tots/crates, POS and documents -> dashboards and reports per type.

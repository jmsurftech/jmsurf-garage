# Next steps for JMSURF POS

The website build is already fixed and live again (the email add-on on the hosting account was breaking every build; it is now removed and a fresh build published successfully).

Below is what I propose to do next, in order.

## 1. Self-service shops and paid custom domains — nothing for you to approve

- Registration stays exactly as it is: anyone signs up and starts trading immediately, with their free address (name.jmsurfpos.co.ke) switched on automatically.
- In their own Settings, an owner can add a custom domain (e.g. shop.example.com). They pay KES 300 by M-Pesa right there.
- Once the payment is confirmed, the domain is activated automatically: it is added to the hosting site, the certificate is issued and the owner sees the DNS record to set at their registrar, with a live status that flips to Active on its own.
- No admin approval step anywhere. You only get a read-only list of paid domains for your records.

## 2. Walk a real sale end to end on the live site

Sign in on the live site as an existing shop, sell a shirt with a size and colour, confirm stock drops by the right amount, then confirm the sale shows in the day's report. I report exactly what I see and fix anything that breaks.

## 3. Liquor store module, matched to the cloth line

- Crates: record items by crate, set bottles per crate and crate deposit; buying and selling by crate or bottle keeps one shared stock count.
- Empties: track empty bottles and crates returned by customers, with deposits refunded or charged on the bill.
- Open bills (tabs): open a tab, keep adding rounds, settle by cash, card or M-Pesa, then print.
- An admin panel section for liquor shops mirroring the cloth line one, so you can manage this centrally.

## 4. Credentials clean-up

- Change the database password to a new strong one and update everything that uses it.
- Remove the hosting and database tokens stored in this project, keeping only what the running system needs.
- The Cloudflare and Supabase tokens you pasted in chat must be deleted by you in those accounts; I will tell you exactly where, as neither account allows me to delete its own token.

## 5. Live M-Pesa KES 1 prompt

Confirm the live keys are the production ones (not sandbox), fire a real KES 1 prompt to your phone, and confirm the money leaves, the callback lands and the sale is marked paid. If the keys are still sandbox, I will say so and tell you which value to supply.

## Technical notes

- Pending shops: `tenants.approval_status` (pending/approved/rejected) plus an admin review screen; login is blocked with a clear message while pending. Existing shops are backfilled as approved.
- Custom domains reuse the existing `tenant_domains` table and `sync-shop-domains` function.
- Liquor: extend `products` (crate fields already exist) with empties tracking tables and reuse `open_bills`/`bill_payments`.
- Password rotation via the database Management API, then update the stored connection values.

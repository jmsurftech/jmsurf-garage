# Move to subdomains, Netlify hosting, your own database

Every shop gets its own address like `azil.jmsurfpos.co.ke`. Old links like `jmsurfpos.co.ke/azil` keep working and send people to the new address. New shops work the moment they register, with nothing to set up per shop.

## First: change that database password

You pasted your database password into chat, so treat it as public. Change it in your Supabase project settings — that is the one thing I'd ask you to do, and everything below still works after you change it.

## 1. Subdomains in the app

- The app reads the web address. If it is `<shop>.jmsurfpos.co.ke`, it loads that shop directly, no slug in the path.
- `jmsurfpos.co.ke/<shop>` keeps working and forwards to the subdomain, so old bookmarks, printed receipts and saved links survive.
- Reserved names (`www`, `admin`, `app`, `api`, `pay`, `mail`, plus the existing reserved list) can never be a shop address; registration blocks them.
- Sign-in, password reset, email links, receipts and the store-URL box in Settings all switch to the subdomain form.
- Existing shops need no change: their current slug becomes their subdomain automatically.

## 2. Hosting on Netlify

- Add a `netlify.toml` carrying the build settings, the deep-link rule and the security headers currently in `public/_headers`.
- Netlify builds straight from the project's GitHub repo, so every change made here deploys itself.
- The site gets `jmsurfpos.co.ke` plus a wildcard alias `*.jmsurfpos.co.ke`, which covers every shop that will ever exist. Certificates renew on their own.

## 3. Cloudflare DNS

Cloudflare is connected to this project, so I will read the current records, tell you exactly what changes, and write them once you say go:

- apex and `www` point at the Netlify site
- one wildcard `*` record points at the same site

That single wildcard is why nothing has to be created per shop, ever.

## 4. Moving the database to your Supabase project

I run this end to end against your project using the connection details you gave:

1. Copy the full structure — every table, security rule, function, trigger, enum, index and storage bucket — into your project.
2. Copy all the data, including user accounts and passwords, so everyone signs in exactly as before.
3. Recreate the three image buckets (product images, taxonomy images, shop logos) and copy the files across.
4. Register the migration history so future changes I make here apply to your database cleanly.
5. Point the app at your project and rebuild.
6. Verify: sign in, load a dashboard, ring up a sale, check stock movement and reports against the new database.

I do steps 1 to 6. You do nothing.

One honest caveat: the final switch of this project's backend connection is a single toggle in project settings that only your account can press. I will prepare everything so that when you press it, the app is already pointing at a fully loaded, verified copy of your data — no downtime window where things are half-moved. If you'd rather not press anything, say so and I'll instead keep the app reading your Supabase project directly through its own settings, which needs no toggle at all.

## 5. M-Pesa, PayHero and everything else keep working

Nothing for you to re-enter. For each background service I redeploy it to your project and move its keys across:

- M-Pesa Daraja: STK push, payment callbacks, B2C payouts, retries and timeouts
- PayHero: payments, callbacks, status checks, bank withdrawals
- Paystack, IntaSend
- Emails (account emails, welcome, receipts, invoices, signup alerts) and SMS/WhatsApp
- Scheduled jobs: recurring billing, payout retries, subscription notices

The payment providers hold callback web addresses that point at the old backend. Those get updated to the new ones as part of the work, and I test a live KES 1 M-Pesa prompt and a PayHero payment afterwards to prove money still flows before we call it done.

## Technical notes

- `HostRedirector` in `src/App.tsx` currently no-ops on `*.jmsurfpos.co.ke`; it becomes the primary tenant source, resolving via `tenants_public`. `getSlugFromPath` in `useTenant.tsx` gains a host-first source with the path as fallback.
- Apex `/<slug>/*` → `https://<slug>.jmsurfpos.co.ke/*` redirect behind a flag, switched on after DNS is verified.
- Cloudflare SSL mode Full (strict); wildcard CNAME proxied to the Netlify site.
- DB move: `pg_dump --no-owner --no-privileges` of `public` + `auth.users` + `storage` metadata, restored to the new project; storage objects copied via the storage API; `supabase_migrations.schema_migrations` seeded from `supabase/migrations`.
- Edge functions redeployed against the new project ref; all secrets in the current project re-set there; provider callback URLs (`mpesa-callback`, `payhero-callback`, `aggregator-callback`, `paystack-verify`) repointed.
- `.env` and Netlify env updated with the new project URL and publishable key.

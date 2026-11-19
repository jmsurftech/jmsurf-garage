# JMSURF Garage integrations

Everything JMSURF Garage connects to: JMSURF PAY, Safaricom Daraja (M-Pesa direct), Paystack and the
other card gateways, JMSURF SMS, JMSURF MAIL, WhatsApp (Cloud API and APIWAP), JMSURF TAX (KRA eTIMS
hub), JMSURF CALL CENTRE and the JMSURF SYSTEMS hub.

Where things live:

| Part | Files |
| --- | --- |
| Pure helpers (signatures, encryption, Daraja password, phones, invoice matching, SMS fit) | `integrations-core.js` (tests: `src/garage/integrations/core.test.ts`) |
| Integrations server area `/api/garage/i/*` | `garage-integrations.js` |
| JMSURF PAY (company + platform collections) | `sendmoney.js`, `payments.js` (platform fees) |
| Company Daraja app, Paystack | `gateways.js` |
| Other card / wallet gateways | `providers.js`, `hub.js` (`/api/pay/*`) |
| Invoice payment links | `paylinks.js` |
| SMS / WhatsApp sending | `messaging.js`, `jmsurfsms.js` |
| KRA eTIMS | `etims.js` |
| Screens | `src/garage/integrations/*` (WhatsApp inbox, Call centre, System → Connections, Super admin → Settings → Integrations) |
| Database | `supabase/migrations/20261120003000_garage_integrations.sql` |

## Environment variables (names only)

A platform credential set in the server environment always wins. Most of them can instead be saved by
the platform owner in **Super admin → Settings → Integrations** (stored encrypted in
`platform_settings.garage_integrations`, refreshed every minute). Never commit values.

| Name | Purpose | Issued by |
| --- | --- | --- |
| `SUPABASE_URL`, `VITE_SUPABASE_URL` | garage-db API | Supabase (garage-db) |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | checks staff sessions | Supabase (garage-db) |
| `JMSURF_SUPABASE_SERVICE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | server database access | Supabase (garage-db) |
| `PUBLIC_ORIGIN` | address in callback URLs (default `https://garage.jmsurf.co.ke`) | you |
| `GARAGE_SECRETS_KEY` | 32-byte key (64 hex or base64) encrypting company and platform keys at rest. Without it a key is derived from the service key; set it before go-live and never change it afterwards (saved keys would have to be entered again) | you (generate) |
| `JMSURFPAY_API_KEY` (also read: `SENDMONEY_API_KEY`) | JMSURF TECHNOLOGIES key: provisions every company's Till / Paybill / bank (`POST /api/saas/provision-tenant`, source `jmsurf-garage`, externalId = company id) and the platform channel (externalId `jmsurf-garage-platform`) | JMSURF PAY |
| `JMSURFPAY_BASE_URL` | optional, staging JMSURF PAY | JMSURF PAY |
| `SENDMONEY_WEBHOOK_SECRET` | verifies `X-Webhook-Signature` on JMSURF PAY webhooks (falls back to `PAYMENT_CALLBACK_TOKEN`) | JMSURF PAY |
| `PAYMENT_CALLBACK_TOKEN` | token on Daraja / PayHero callback URLs (`?token=`) | you (generate) |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, `MPESA_SHORTCODE`, `MPESA_ENVIRONMENT` | platform Daraja app, only for package fees collected by Daraja | Safaricom Daraja |
| `DARAJA_TRUSTED_IPS` | optional CIDR list for C2B callbacks (default Safaricom `196.201.212.0/22`) | Safaricom |
| `PAYSTACK_SECRET_KEY` | platform Paystack (package fees by card) | Paystack |
| `PAYHERO_*` | legacy PayHero (kept working) | PayHero |
| `JMSURF_SMS_API_KEY` | platform SMS (JMSURF TECHNOLOGIES key) | JMSURF SMS |
| `JMSURF_SMS_SENDER` | optional platform sender ID | JMSURF SMS |
| `JMSURF_SMS_URL` | optional, default `https://jmsurfsms.co.ke` | JMSURF SMS |
| `JMSURF_MAIL_KEY`, `JMSURF_MAIL_URL` (`https://api.jmsurfmail.co.ke`), `JMSURF_MAIL_FROM` | every platform email goes through JMSURF MAIL first | JMSURF MAIL |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `SMTP_ENCRYPTION` | fallback mail relay when JMSURF MAIL is not set or fails | JMSURF MAIL relay |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET` | platform WhatsApp Cloud API number (platform notices; platform Meta app for companies using it) | Meta |
| `WHATSAPP_VERIFY_TOKEN` | verify token for the platform webhook (no `?c=`) | you (generate) |
| `WHATSAPP_GRAPH_VERSION` | optional, default `v21.0` | Meta |
| `ETIMS_PARTNER_KEY` | JMSURF Garage partner key at the eTIMS hub (partner code `garage`) | JMSURF TAX |
| `ETIMS_PARTNER_CODE` | optional, default `garage` (prefixes hub idempotency keys) | JMSURF TAX |
| `ETIMS_HUB_URL` | optional, default `https://etims.jmsurf.co.ke` | JMSURF TAX |
| `CALLCENTRE_DB_URL`, `CALLCENTRE_SERVICE_KEY` | dash-db Supabase URL + service key (the Call Centre's data) | JMSURF DASH |
| `CALLCENTRE_LOOKUP_KEY` | platform key the Call Centre may use for screen pop / missed calls | you (generate) |
| `CALLCENTRE_APP_URL` | optional, default `https://app.jmsurfcallcentre.co.ke` | JMSURF CALL CENTRE |
| `CC_BILLING_ENABLED` | leave unset: Call Centre billing runs on DASH | — |

The mail key is read by `server.js` at start-up from the env only; a value saved in the super admin is
used by its Test button.

## Addresses to register

| What | URL | Where |
| --- | --- | --- |
| JMSURF PAY webhook | `https://garage.jmsurf.co.ke/api/garage/i/pay/webhook` | JMSURF PAY account (signed with `SENDMONEY_WEBHOOK_SECRET`) |
| Daraja C2B (per company) | `https://garage.jmsurf.co.ke/api/garage/i/c2b/<company token>/confirm` and `/validate` | registered by **System → Connections → Register with Safaricom** |
| Daraja STK callbacks | `/api/payments/daraja/callback` (sales), `/api/payments/daraja/invoice-callback` (invoices) | sent with each STK request |
| WhatsApp (company's own Meta app) | `https://garage.jmsurf.co.ke/api/garage/i/whatsapp/webhook?c=<company id>` + the verify token shown in Connections | Meta app → WhatsApp → Configuration, field `messages` |
| WhatsApp (platform Meta app) | `https://garage.jmsurf.co.ke/api/garage/i/whatsapp/webhook` + `WHATSAPP_VERIFY_TOKEN` | Meta app |
| Call Centre screen pop | `GET /api/garage/i/callcentre/lookup?phone=` | see `docs/garage-callcentre.md` |
| Call Centre missed call | `POST /api/garage/i/callcentre/missed` | see `docs/garage-callcentre.md` |

## Per integration

### JMSURF PAY
Companies enter only Till / Paybill (+ account name) / Bank (bank paybill + account number) in
**System → Online payments** (or Connections → M-Pesa). `sendmoney.js` provisions the channel with the
JMSURF TECHNOLOGIES key; nobody ever types API keys or tenant codes. The platform's own package fees use
the channel with externalId `jmsurf-garage-platform` (Super admin → Settings → Payments). Prompts are
reconciled by polling (every 5–6 s) and, when JMSURF PAY sends a signed webhook, at once.

### Daraja (company's own app)
System → Connections → M-Pesa → "My own Daraja app": type (paybill / till; a till may add its store
number), environment, consumer key, consumer secret, passkey. Keys are encrypted (AES-256-GCM,
`integration_secrets.daraja_*`) and never sent back to the browser. The gateway then becomes `daraja`:
STK push (POS sales and invoices: staff, customer portal, payment links), STK query (every 15 s for open
prompts), C2B registration. C2B confirmations are stored once per transaction (`garage_mpesa_c2b`),
accepted only from Safaricom's addresses (sandbox excepted) and matched to an open invoice by the account
number (`INV-0012`, `inv 12`, `12`, `<bank>#INV-0012`). Unmatched payments wait in Connections to be
applied by hand. "Strict" validation refuses unknown accounts before the money moves (needs Safaricom's
External Validation). B2C (payouts) stays off.

### Other gateways
Paystack (company key in business_settings), PayHero (legacy) and the extra gateways in `providers.js`
work as before; only identifiers changed.

### JMSURF SMS
Companies send with their own prepaid JMSURF SMS key / units and sender ID (System → SMS & WhatsApp).
Platform SMS uses `JMSURF_SMS_API_KEY`. Every automatic message (reminders, job updates, links, missed
calls, platform notices) is passed through `fitOneSms()`: GSM characters only, one 160-character part, a
trailing link kept whole. Typed messages (manual, bulk, journeys) are left as written.

### JMSURF MAIL
`server.js` sends every platform email through JMSURF MAIL first and falls back to the saved SMTP / the
SMTP relay env. Companies can set their own SMTP under System → Email.

### WhatsApp
Two routes, chosen per company: WhatsApp Cloud API (Meta) when connected in Connections, else APIWAP.
Inbound Cloud API messages land in the two-way inbox (**WhatsApp** in the menu, module `whatsapp`) with
the customer, vehicles, open jobs and unpaid invoices beside the chat, and buttons to send the estimate,
tracking or payment link or an M-Pesa prompt. Outside the 24-hour window a message goes out in the
company's approved template (body `{{1}}`); without one it falls back to APIWAP if set up.

### JMSURF TAX (KRA eTIMS)
`etims.js` uses the hub partner API with `ETIMS_PARTNER_KEY` (partner code `garage`). Companies connect in
System → KRA eTIMS (PIN, branch, device serial). Automatic signing is on unless switched off, so every
sales invoice and credit note, including those made from job cards, is signed within ~2 minutes; signed
documents print the KRA QR code. Default item classes: labour / services `7818150000`, parts
`2517000000` (UNSPSC vehicle repair services / vehicle components) — **confirm with KRA** and change in
System → KRA eTIMS or per item.

### JMSURF CALL CENTRE
See `docs/garage-callcentre.md`.

### JMSURF SYSTEMS hub
The super admin works at `admin.garage.jmsurf.co.ke` and inside the hub at `sys-garage.jmsurfsys.co.ke`
(`src/lib/host.ts` HUB_PLATFORM_HOST; the browser client sends the platform context there and
`platform.js` accepts that host for super-admin powers). Hub SSO for Supabase systems needs no code in
the app: the hub signs in server-side with GoTrue (generate_link + verify, TOTP answered) and writes the
session. Hub-side steps: add `garage` to the hub's `systems.js` (admin host `admin.garage.jmsurf.co.ke`,
`supa` storage local), add the owner email to `ssoAs.garage`, re-run `mksupa.py`, add a Traefik route for
`sys-garage.jmsurfsys.co.ke`, and add Garage's `subscription_payments` to the hub's payment collector.

## Helper APIs for the other areas

Server (import from `./garage-integrations.js`):

```js
requestInvoicePayment({ tenantId, invoiceId, phone, amount?, requestedBy? })
  // M-Pesa prompt through the company's gateway (JMSURF PAY or own Daraja) → { success, request_id } | { error, status }
invoicePaymentStatus(tenantId, requestId)        // → { status: pending|completed|failed|cancelled|unknown, mpesa_receipt }
invoicePayLink(tenantId, invoiceId)              // → https://<company>/pay/<token> | null (draft / void)
sendCustomerMessage({ tenantId, channel: "sms"|"whatsapp", to, text, event, userId?, reference? })
  // events: job_status | estimate | payment_request | service_reminder | booking | missed_call | manual
  // automatic events are cut to one SMS part; the company's "What uses SMS" choices apply
waSendForCompany(tenantId, phone, text, { userId?, template?, lang?, params? })   // Cloud API only, kept in the inbox
waCloudConnected(tenantId)                       // → boolean
customerContext(tenantId, { phone?, customerId? }) // → { customer, vehicles, jobs, invoices }
signDocument(tenantId, "invoice"|"credit_note", id) // KRA signing now → { ok, rcpt_no, qr_url } | { ok, pending } | { ok:false, error }
```

Unchanged older helpers: `sendForShop` / `sendPlatform` (`messaging.js`), `pushInvoiceForShop` /
`invoicePromptStatus` (`sendmoney.js`, now also for Daraja companies), `payLinkUrl` (`paylinks.js`).

**Workshop hook** — `garage-workshop.js` may export
`customerContext(tenantId, { customerId, phone })` returning
`{ vehicles: [{ id, registration, make, model, year }], jobs: [{ id, number, status, vehicle, tracking_url, estimate_url }] }`.
The WhatsApp inbox side panel and the Call Centre screen pop show whatever it returns; tracking /
estimate links must be on the company's own address.

Browser (import from `@/garage/integrations`):

```ts
garageI(path, body)                       // POST /api/garage/i/<path>
requestInvoiceMpesa(invoiceId, phone, amount?) / invoiceMpesaStatus(requestId)
sendWhatsApp(phone, text)                 // Cloud API or APIWAP, kept in the inbox
openCallCentre(next?)                     // opens JMSURF CALL CENTRE signed in
sendShopMessage(channel, to, text, reference?, kind?)  // "@/lib/messaging", unchanged
```

# JMSURF Garage ↔ JMSURF CALL CENTRE

JMSURF CALL CENTRE (`app.jmsurfcallcentre.co.ke`) keeps its companies, logins, calls and billing in
JMSURF DASH's database (dash-db). Garage's data lives in garage-db. The link below works **without any
change to the Call Centre repo**.

## What happens when staff press "Open JMSURF CALL CENTRE"

`POST /api/garage/i/callcentre/open` (garage-integrations.js), server to server with
`CALLCENTRE_DB_URL` + `CALLCENTRE_SERVICE_KEY` (dash-db URL and service key):

1. **Company twin (once per Garage company).** A service login `cc-<garage company id>@garage.jmsurf.co.ke`
   is created in dash-db with sign-up metadata `registration_type: tenant`, `start_apps: ["callcentre"]`,
   `focus_app: callcentre`, `signup_source: garage`, `garage_tenant_id`, `store_slug: garage-<slug>`, so
   DASH's normal sign-up trigger creates the company with the Call Centre trial. The twin is marked in
   `business_settings.erp_settings.garage_mirror` (`tenant_id`, `slug`, `origin`) and by its `garage-`
   slug, so it is never taken for a DASH company. Nobody signs in as the service login. The link is kept
   in garage-db `garage_connections.cc_tenant_id`.
2. **Member.** The staff member's email is found or created as a dash-db login (random password,
   confirmed), added to `tenant_members` of the twin (Garage admin → admin, manager → manager, others →
   cashier) and `switch_company_for` makes the twin their current company. Kept in `garage_cc_users`.
3. **Sign-in.** A magic-link `hashed_token` is generated (GoTrue admin `generate_link`) and the browser
   opens `https://app.jmsurfcallcentre.co.ke/auth/handoff#th=<token>&next=/` — the same handoff DASH uses.

Phone line, IVR, queues and agents are then set up inside the Call Centre as usual. A person who also
uses DASH with the same email keeps one JMSURF login; opening the Call Centre from Garage switches
their current company to the Garage twin (DASH's company switcher brings them back).

## Screen pop and missed calls (Garage side, ready now)

Authentication: `Authorization: Bearer <key>` where the key is either

* the company's own key (`gcl_…`, made in System → Connections → Call Centre, shown once, stored as a
  hash), or
* the platform key `CALLCENTRE_LOOKUP_KEY` plus `cc_tenant=<dash-db company id>` (the twin's id).

| Call | Answer |
| --- | --- |
| `GET /api/garage/i/callcentre/lookup?phone=0712…` | `{ customer, vehicles, jobs, invoices, links: { customer, inbox } }` |
| `POST /api/garage/i/callcentre/missed` `{ phone, called_at?, note?, cc_tenant? }` | creates a callback task (Garage → Call centre → "To call"), rings the bell, and texts the caller once per 30 minutes (one SMS, editable text, can be switched off) |

Vehicles and jobs come from the workshop area through `garage-workshop.js` `customerContext()`.

## What the Call Centre would need later for full screen pop

Nothing above requires it, but to show Garage data inside the Call Centre's own screens:

1. **Screen pop:** in `src/components/ScreenPop.tsx`, when the current company has
   `erp_settings.garage_mirror`, call the Garage lookup instead of (or after) `cc_screen_pop()`:
   `GET <garage_mirror.origin>/api/garage/i/callcentre/lookup?phone=<caller>&cc_tenant=<company id>` with
   the platform `CALLCENTRE_LOOKUP_KEY` (kept server-side: add a small proxy route in the Call Centre's
   `server.js`, never in the browser), and render customer, vehicles, open jobs and unpaid invoices with
   links back to Garage.
2. **Missed calls:** where a missed call becomes a callback (`cc_callbacks`), also
   `POST <origin>/api/garage/i/callcentre/missed` `{ phone, called_at, cc_tenant }` for Garage twins.
3. **Click-to-call from Garage** (optional): a Call Centre deep link such as
   `/console?dial=<number>` that Garage can open through the same handoff (`next=`).
4. **Billing:** Garage twins use the Call Centre's own plans and billing on DASH's server, unchanged.

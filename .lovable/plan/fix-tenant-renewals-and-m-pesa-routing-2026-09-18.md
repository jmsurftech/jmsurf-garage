# Fix tenant renewals and M-Pesa routing

## Goal
Make renewals resolve the signed-in shop reliably, ensure every saved Till/Paybill works at POS, and deduct PayHero's charge from the tenant payout instead of JMSURF funds.

## Changes
- Resolve the renewal shop from the authenticated profile, tenant subdomain, and an explicitly validated tenant identifier so valid shop accounts cannot fall through to “No shop is linked”.
- Send the active tenant identifier from Billing and show a sign-in/session message only when no valid shop can be resolved.
- Make POS use the saved tenant payout channel consistently, including automatically repairing or registering a missing PayHero channel from the saved Till/Paybill.
- Stop translating all gateway failures into “M-Pesa not set”; show the actual actionable payment error.
- Store PayHero fee and net payout amounts, extract the actual charge returned by PayHero, and settle the tenant at gross minus fee exactly once.
- Keep customer prices unchanged; the tenant payout absorbs the PayHero charge.
- Correct the missing `payments` feature allow-list entry so package/tenant changes persist.

## Verification
- Confirm After Hours resolves its live custom subscription and features.
- Test renewal start as a tenant account and verify the platform payment route reaches JMSURF.
- Test a configured tenant POS prompt and verify the saved channel is accepted.
- Verify fee/net calculations are idempotent across webhook and polling paths.
- Deploy the changed functions to the owner database and publish the frontend through Netlify.

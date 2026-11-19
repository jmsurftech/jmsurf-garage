# Billing card pricing sync

## Changes
- Show the tenant subscription's saved custom price, user limit, and location limit on the current-package card instead of reverting to the plan defaults.
- Calculate bulk renewal amounts from the tenant's saved monthly amount, while retaining the normal plan prices for other packages.
- Make the current price larger and bolder.
- Rework Monthly, Quarterly, Semi-annually, and Yearly into a clearer responsive selector with duration and price.
- Refresh the billing subscription automatically when an administrator changes it, including when returning to the page.

## Technical details
- Subscribe the billing query to subscription changes for the current tenant and invalidate its cached query immediately.
- Keep checkout tied to the selected plan and period while showing custom tenant pricing accurately on the current card.
- Verify TypeScript after the update.

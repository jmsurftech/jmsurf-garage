# Billing package and bulk-payment update

## What will change
- Show each tenant’s active package or trial as the main Billing card, including included features and expiry date.
- Put Monthly, Quarterly, Semi-annually, and Yearly choices directly on the current-package card so renewal can be paid in bulk.
- Hide the other package cards by default and add a **View other packages** button below the current card.
- When alternatives are revealed, keep the same billing-period choices and let the tenant select another package.
- Extend subscription payment processing so semi-annual payments charge six months and extend access by six months.
- Keep existing M-Pesa loading, cancellation detection, Try again, and Enter-to-pay behavior.

## Verification
- Check Billing for a trial tenant and an active subscriber.
- Confirm alternative packages stay hidden until requested.
- Confirm all four periods show the correct amount and the payment request sends the selected period.
- Run the TypeScript checks and verify the Billing screen in the preview.

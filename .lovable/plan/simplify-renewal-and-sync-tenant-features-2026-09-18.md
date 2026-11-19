# Simplify renewal and sync tenant features

## Changes
- Remove payment-period choices from the current package card.
- Place a “Renew Package” button at the card’s top right.
- Show Monthly, Quarterly, Semi-annually, and Yearly choices inside the renewal/payment popup, followed by the selected amount, M-Pesa number, and Pay button.
- Make “View other packages” use the main accent colour.
- Load tenant feature overrides on the billing page, merge them with package features, and refresh the included-feature list immediately after superadmin changes.

## Verification
- Check the billing page types and confirm renewal amounts still match the selected period and tenant-specific price.

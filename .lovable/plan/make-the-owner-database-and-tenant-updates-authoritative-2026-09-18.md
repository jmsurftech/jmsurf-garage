# Make the owner database and tenant updates authoritative

## Goal
Ensure the production site and every deploy use the owner-managed database only, and make super-admin changes to tenant pricing, user/location limits, and enabled modules appear immediately in tenant sessions.

## Changes
- Audit and remove stale database project references from deployable application and function code, while leaving generated Lovable preview bindings untouched.
- Add a production configuration guard so a Netlify build fails rather than publishing against the wrong database.
- Verify the Netlify/GitHub deployment configuration uses the intended public database URL/key and no private credentials are committed.
- Consolidate tenant package loading so Billing, navigation, and user/location limits read the same latest subscription and feature overrides.
- Update realtime listeners to refresh all related cached views immediately, with reconnect/focus fallback for missed events.
- Ensure super-admin saves update the current subscription and tenant override record atomically, then refresh the admin view.
- Confirm the required tables are included in realtime publication and accessible under existing tenant-safe policies.

## Verification
- Run focused checks and the project typecheck/build harness.
- Verify the production build is pointed at the intended database.
- Test an admin price/limit/module change and confirm the tenant Billing/navigation updates without a manual reload.
- Publish through the existing GitHub-to-Netlify path if its credentials and workflow are available; otherwise leave the repository ready with a fail-safe build guard.

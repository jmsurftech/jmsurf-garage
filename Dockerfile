# --- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Build-time configuration (supplied by Coolify build arguments)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID="self-hosted"

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    NODE_ENV=development \
    NPM_CONFIG_PRODUCTION=false

COPY package.json package-lock.json* ./
# The server's network drops now and then mid-install (npm ECONNRESET failed whole builds): retry each
# download with longer waits, use fewer connections at once, and keep npm's cache between builds.
RUN --mount=type=cache,target=/root/.npm \
    npm config set fetch-retries 6 && npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && npm config set maxsockets 6 && \
    (npm ci --include=dev --no-audit --no-fund --prefer-offline || (sleep 20 && npm ci --include=dev --no-audit --no-fund --prefer-offline))

COPY . .
# A release only goes out when the type check and tests pass.
RUN npx tsc --noEmit -p tsconfig.app.json && npm test
# Dependencies install with dev tools (NODE_ENV=development above), but the app must be built
# as production: otherwise React ships its slow development build and offline support is off.
RUN NODE_ENV=production npm run build
# Mail libraries for the helpdesk mailbox reader, bundled into one file.
RUN npx esbuild vendor-mail.src.js --bundle --minify --platform=node --format=esm --target=node22 --outfile=vendor-mail.js   --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

# --- Runtime stage -----------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

# Font for the shop icons and link-preview pictures (shopBrand.js).
RUN apk add --no-cache font-dejavu

# The app server sends email directly, so it needs the backend address at
# runtime as well as at build time.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

ENV NODE_ENV=production \
    PORT=3000 \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

COPY --from=build /app/dist ./dist
# Public website pages with their text in the HTML (scripts/prerender.mjs).
COPY --from=build /app/seo-pages ./seo-pages
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/fetchTimeout.js ./fetchTimeout.js
COPY --from=build /app/payments.js ./payments.js
COPY --from=build /app/sendmoney.js ./sendmoney.js
COPY --from=build /app/staff.js ./staff.js
COPY --from=build /app/hosts.js ./hosts.js
COPY --from=build /app/gateways.js ./gateways.js
COPY --from=build /app/recurring.js ./recurring.js
COPY --from=build /app/monitor.js ./monitor.js
COPY --from=build /app/messaging.js ./messaging.js
COPY --from=build /app/providers.js ./providers.js
COPY --from=build /app/hub.js ./hub.js
COPY --from=build /app/reminders.js ./reminders.js
COPY --from=build /app/water.js ./water.js
COPY --from=build /app/garage.js ./garage.js
COPY --from=build /app/garage-workshop.js ./garage-workshop.js
COPY --from=build /app/garage-specialist.js ./garage-specialist.js
COPY --from=build /app/garage-integrations.js ./garage-integrations.js
COPY --from=build /app/integrations-core.js ./integrations-core.js
COPY --from=build /app/shop.js ./shop.js
COPY --from=build /app/portal.js ./portal.js
COPY --from=build /app/erp.js ./erp.js
COPY --from=build /app/s3.js ./s3.js
COPY --from=build /app/jmsurfsms.js ./jmsurfsms.js
COPY --from=build /app/alerts.js ./alerts.js
COPY --from=build /app/events.js ./events.js
COPY --from=build /app/workflows.js ./workflows.js
COPY --from=build /app/assetArchive.js ./assetArchive.js
COPY --from=build /app/platformcrm.js ./platformcrm.js
COPY --from=build /app/crmPublic.js ./crmPublic.js
COPY --from=build /app/demo.js ./demo.js
COPY --from=build /app/ccbilling.js ./ccbilling.js
COPY --from=build /app/smscredit.js ./smscredit.js
COPY --from=build /app/platformadmin.js ./platformadmin.js
COPY --from=build /app/devapi.js ./devapi.js
COPY --from=build /app/shopBrand.js ./shopBrand.js
COPY --from=build /app/companySeo.js ./companySeo.js
COPY --from=build /app/planPricing.js ./planPricing.js
COPY --from=build /app/ai.js ./ai.js
COPY --from=build /app/etims.js ./etims.js
COPY --from=build /app/migrate.js ./migrate.js
COPY --from=build /app/platform.js ./platform.js
COPY --from=build /app/engage.js ./engage.js
COPY --from=build /app/contracts.js ./contracts.js
COPY --from=build /app/hrPublic.js ./hrPublic.js
COPY --from=build /app/paylinks.js ./paylinks.js
COPY --from=build /app/notes.js ./notes.js
COPY --from=build /app/vendor-mail.js ./vendor-mail.js
COPY --from=build /app/package.json ./package.json

# Only the mail library is needed at runtime; reuse the copy already
# installed in the build stage so no network access is required here.
COPY --from=build /app/node_modules/nodemailer ./node_modules/nodemailer
# Shop icons and link-preview pictures are drawn with resvg (prebuilt binary,
# no system libraries) using the DejaVu font.
COPY --from=build /app/node_modules/@resvg ./node_modules/@resvg
# Dash AI (ai.js) uses the Anthropic SDK and its small runtime dependencies.
COPY --from=build /app/node_modules/@anthropic-ai ./node_modules/@anthropic-ai
COPY --from=build /app/node_modules/standardwebhooks ./node_modules/standardwebhooks
COPY --from=build /app/node_modules/@stablelib ./node_modules/@stablelib
COPY --from=build /app/node_modules/fast-sha256 ./node_modules/fast-sha256
COPY --from=build /app/node_modules/json-schema-to-ts ./node_modules/json-schema-to-ts
COPY --from=build /app/node_modules/ts-algebra ./node_modules/ts-algebra
COPY --from=build /app/node_modules/@babel/runtime ./node_modules/@babel/runtime

# Health probes (this image's own check and Coolify's) use curl or wget.
# Never fail the build if the package mirror is unreachable.
RUN apk add --no-cache curl wget || true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/ > /dev/null 2>&1 \
   || wget -q -O /dev/null http://127.0.0.1:3000/ \
   || node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# run as the unprivileged node user (2026-10-18 security review)
USER node
CMD ["node", "server.js"]

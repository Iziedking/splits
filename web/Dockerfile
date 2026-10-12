# syntax=docker/dockerfile:1
# Production image for Splits: pages, API routes and the in-process sweeper in one Node server.
# Built by .github/workflows/deploy.yml (context: web/) and run by deploy/compose.yml.
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so the WalletConnect
# project id is a build arg. Everything else (DATABASE_URL, Circle keys, ...) is runtime env from
# /opt/splits/prod.env and never enters the image.
#
# Migrations: the app applies web/drizzle/ itself when it first builds its context (on the first
# request, the healthcheck, or the sweeper's first tick), so drizzle/ ships in the image.

ARG NODE_IMAGE=node:22.23.3-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=""
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# SPLITS_STANDALONE=1 switches next.config.ts to output: "standalone".
RUN SPLITS_STANDALONE=1 npx next build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3930 \
    HOSTNAME=0.0.0.0
# Code stays root-owned and read-only to the app user; only Next's cache dir is writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Standalone output leaves public/ out; the logo, icons and the emailed logo are served from it.
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3930
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3930/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# standalone server.js chdirs to /app, so process.cwd()/drizzle resolves to the copy above.
CMD ["node", "server.js"]

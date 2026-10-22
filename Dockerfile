# syntax=docker/dockerfile:1

# One image per release, shared by every instance and both Supabase modes:
# nothing instance-specific is baked in (src/lib/deploy/env.mjs reads it at
# runtime). Commands (docker/entrypoint.sh): serve (default) | status | migrate.
ARG NODE_VERSION=24

# ---- deps ---------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# package-lock.json is not committed: CI passes the tree .github/actions/setup
# resolved for this commit; locally it is the one `npm install` wrote.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- builder ------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner -------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
ARG SUPABASE_CLI_VERSION=2.121.0
ARG HELPDESK_VERSION=dev
# psql holds the migration lock for `migrate`; the CLI's npm package brings a
# musl binary (@supabase/cli-linux-x64-musl) — no Docker needed.
RUN apk add --no-cache postgresql17-client \
 && npm install -g --no-audit --no-fund supabase@${SUPABASE_CLI_VERSION} \
 && npm cache clean --force
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    HELPDESK_VERSION=${HELPDESK_VERSION}
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 -G nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY supabase/migrations ./supabase/migrations
COPY docker ./docker
COPY src/lib/deploy ./docker/lib
USER nextjs
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["serve"]

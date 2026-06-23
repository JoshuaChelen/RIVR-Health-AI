# syntax=docker/dockerfile:1
# Minimal standalone Next.js image for the RIVR web app (verify-email,
# reset-password, share). Served internally on :3000 behind Caddy.

# --- build stage ---
FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so the prod
# API origin must be set here (not at runtime). .env.local is .dockerignored
# so the localhost default can't leak into the production build.
ENV NEXT_PUBLIC_API_URL=https://api.rivrhealth.ai
RUN npm run build

# --- run stage ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Non-root runtime user.
RUN groupadd -r nodeapp && useradd -r -g nodeapp nodeapp
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER nodeapp
EXPOSE 3000
CMD ["node", "server.js"]

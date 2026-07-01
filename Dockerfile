# Reaparr — Nuxt/Nitro (node-server preset) for Docker on Unraid.
# Multi-stage: build inside Linux so the better-sqlite3 native binary matches
# the runtime arch, then ship a self-contained .output.

# --- builder ------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Toolchain for better-sqlite3's native build.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# --- runtime ------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    PORT=3000 \
    REAPARR_DATA_DIR=/app/data

# Nitro's .output is self-contained (incl. the compiled better-sqlite3 binary).
COPY --from=builder /app/.output ./.output

# Volume for the SQLite file + config (persists across container updates).
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

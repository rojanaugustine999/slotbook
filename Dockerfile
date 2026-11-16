# syntax=docker/dockerfile:1

# ─── What this file does ─────────────────────────────────────────────────────
# A Dockerfile is a recipe for an IMAGE: a sealed copy of your app plus everything
# it needs to run (Node, the libraries, the compiled code). Any machine with Docker
# can run that image and get exactly the same behaviour, which ends "it works on my
# laptop". Hosting platforms like Render and Railway build and run this file for you.
#
# It has two stages. The first compiles the TypeScript and is thrown away; the final
# image keeps only what is needed to RUN the app, so it is smaller and has less in it
# for an attacker to use.
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app

# Prisma's engine needs OpenSSL, which the slim Node image leaves out.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy ONLY the package files first and install. Docker remembers each step, so as
# long as these files are unchanged, later builds skip this slow step entirely and
# only redo the steps after your source code changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci

COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @slotbook/api

# ── Stage 2: the image that actually runs ────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Production libraries only: no TypeScript, no test tools. (The Prisma command-line
# tool IS included: the container uses it to apply database migrations when it starts.)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev && npm cache clean --force

COPY apps/api/prisma apps/api/prisma
RUN ./node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma

# The compiled JavaScript from stage 1. The TypeScript source never enters this image.
COPY --from=build /app/apps/api/dist apps/api/dist

# Run as the unprivileged "node" user that comes with the image, never as root. If
# someone ever found a way to run code inside the app, they'd have very little power.
USER node

EXPOSE 4000

# Docker (and most hosts) call this every 30 seconds. If it fails, the container is
# marked unhealthy and can be restarted automatically.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# On every start: first bring the database up to date (migrations that are already
# applied are skipped, so this is safe to repeat), then start the server.
# Settings such as DATABASE_URL arrive as environment variables from the host.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/server.js"]

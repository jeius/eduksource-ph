# syntax=docker/dockerfile:1

# ---- Base image with pnpm enabled ----
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat gcompat
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ---- Prune the monorepo down to just what "studio" needs ----
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.10.8
COPY . .
RUN turbo prune @eduksource/studio --docker

# ---- Install dependencies ----
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

# ---- Build ----
FROM base AS builder
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
RUN pnpx turbo build --filter=@eduksource/studio

# ---- Deploy: self-contained, symlink-free output for the runtime image ----
FROM builder AS deployer
RUN pnpm --filter=@eduksource/studio --prod deploy /app/deploy

# ---- Runtime image ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 hono

COPY --from=deployer --chown=hono:nodejs /app/deploy .

USER hono
EXPOSE 8080
CMD ["node", "dist/index.js"]
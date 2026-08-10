# syntax=docker/dockerfile:1

# Local development image. The compose stack bind-mounts the repo over /app,
# so this layer exists to install dependencies against Linux (the macOS
# node_modules in your working copy can't be reused) — the anonymous volume in
# docker-compose.yml keeps it from being shadowed by the mount.
FROM node:24-alpine AS dev

RUN corepack enable
WORKDIR /app

# Postgres client tools: the migrate service waits on the database with them.
RUN apk add --no-cache postgresql-client curl

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["pnpm", "dev"]


# Production-shaped image, for checking a real build locally or deploying
# somewhere that isn't Vercel.
FROM node:24-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine AS prod

WORKDIR /app
ENV NODE_ENV=production

# `output: "standalone"` in next.config.ts emits a self-contained server plus
# only the node_modules it actually needs.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]

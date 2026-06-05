# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @hwptopdf/shared build \
 && pnpm --filter @hwptopdf/api exec prisma generate \
 && pnpm --filter @hwptopdf/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 8000
# Apply migrations, then start the server.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/server.js"]

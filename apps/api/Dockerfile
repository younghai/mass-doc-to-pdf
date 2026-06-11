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
# HWP precision engine (rhwp) + PNG preview (poppler) + Korean fonts.
# rhwp-python is pinned for reproducible quality; bump deliberately and re-run
# the quality corpus (docs/changes/2026-06-11-hwp-quality-corpus.md).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv poppler-utils \
      fonts-nanum fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/rhwp \
    && /opt/rhwp/bin/pip install --no-cache-dir rhwp-python==0.7.0
ENV RHWP_PYTHON=/opt/rhwp/bin/python3
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 8000
# Apply migrations, then start the server.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/server.js"]

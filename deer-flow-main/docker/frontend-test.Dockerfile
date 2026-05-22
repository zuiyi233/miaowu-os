ARG PNPM_STORE_PATH=/root/.local/share/pnpm/store
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:22-alpine AS base
ARG PNPM_STORE_PATH
ARG NPM_REGISTRY
RUN if [ -n "${NPM_REGISTRY}" ]; then export COREPACK_NPM_REGISTRY="${NPM_REGISTRY}"; fi \
    && corepack enable \
    && corepack install -g pnpm@10.26.2
RUN pnpm config set store-dir ${PNPM_STORE_PATH} \
    && pnpm config set registry "${NPM_REGISTRY}" \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set network-timeout 600000 \
    && pnpm config set fetch-retries 5 \
    && pnpm config set fetch-retry-factor 2 \
    && pnpm config set fetch-retry-mintimeout 10000 \
    && pnpm config set fetch-retry-maxtimeout 120000
WORKDIR /app
COPY frontend ./frontend

FROM base AS builder
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    cd /app/frontend && pnpm install --config.frozen-lockfile=true --config.network-timeout=600000
RUN cd /app/frontend && SKIP_ENV_VALIDATION=1 pnpm build

FROM node:22-alpine AS prod
ARG PNPM_STORE_PATH
ARG NPM_REGISTRY
RUN if [ -n "${NPM_REGISTRY}" ]; then export COREPACK_NPM_REGISTRY="${NPM_REGISTRY}"; fi \
    && corepack enable \
    && corepack install -g pnpm@10.26.2
RUN pnpm config set store-dir ${PNPM_STORE_PATH} \
    && pnpm config set registry "${NPM_REGISTRY}"
WORKDIR /app
COPY --from=builder /app/frontend ./frontend
EXPOSE 3000
CMD ["sh", "-c", "cd /app/frontend && pnpm start"]

# Data worker (scheduler + CLI jobs) and database migrations. Node runs the TypeScript sources
# directly via native type stripping, so there is no build step.
FROM node:24-alpine AS deps
RUN npm install -g pnpm@12.21.0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --prod --filter "worker..." --filter "@deals/db..."

FROM node:24-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production TZ=Asia/Shanghai
RUN apk add --no-cache tzdata && addgroup -S app && adduser -S app -G app
COPY --from=deps /repo ./
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/worker apps/worker
USER app
CMD ["node", "apps/worker/src/main.ts", "schedule"]

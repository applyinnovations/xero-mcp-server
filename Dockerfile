# Update this digest and .nvmrc together when moving to a newer Node 24 LTS patch.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json vitest.config.ts eslint.config.js ./
COPY src ./src
RUN npm run build && npm test && npm run lint

FROM base AS production-dependencies
COPY package.json package-lock.json ./
# The root prepare script needs the development toolchain; compilation is above.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/applyinnovations/xero-mcp-server" \
      org.opencontainers.image.licenses="MIT"
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE ./
USER node
ENTRYPOINT ["node", "dist/index.js"]

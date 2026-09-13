FROM node:24.21.0-bookworm-slim AS build
ENV WRANGLER_SEND_METRICS=false
RUN npm install -g pnpm@11.19.0
WORKDIR /app
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/ ./
RUN pnpm build
FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production WRANGLER_SEND_METRICS=false HOME=/home/node
WORKDIR /app
COPY --from=build --chown=node:node /app/ ./
RUN mkdir -p .wrangler dist/server/.wrangler node_modules/.mf && chown -R node:node .wrangler dist/server/.wrangler node_modules/.mf && chmod 700 .wrangler dist/server/.wrangler
USER node
EXPOSE 80 443 4310
CMD ["node", "scripts/docker-start.mjs"]

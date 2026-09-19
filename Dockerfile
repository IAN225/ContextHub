FROM node:24.21.0-bookworm-slim AS build
RUN npm install -g pnpm@11.19.0
WORKDIR /app
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/ ./
RUN pnpm build
FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production HOME=/home/node
WORKDIR /app
COPY --from=build --chown=node:node /app/production/ ./
RUN mkdir -p .wrangler && chown node:node .wrangler && chmod 700 .wrangler
USER node
EXPOSE 80 443 4310 8080
CMD ["node", "scripts/docker-start.mjs"]

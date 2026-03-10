FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY api/package*.json ./
RUN npm ci

FROM deps AS build
COPY api/tsconfig.json ./tsconfig.json
COPY api/src ./src
RUN npm run build

FROM deps AS prod-deps
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY api/package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/index.js"]

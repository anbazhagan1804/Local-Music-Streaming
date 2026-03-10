FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY web/package*.json ./
RUN npm ci

COPY web/tsconfig.json ./tsconfig.json
COPY web/vite.config.ts ./vite.config.ts
COPY web/index.html ./index.html
COPY web/src ./src
RUN npm run build

FROM nginx:1.29-alpine
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

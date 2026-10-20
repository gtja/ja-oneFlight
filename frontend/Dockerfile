FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /build
RUN npm install --global pnpm@10.33.0
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
RUN pnpm run build

FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80

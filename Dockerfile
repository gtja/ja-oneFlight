FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend-build
WORKDIR /build
RUN npm install --global pnpm@10.33.0
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY frontend/ ./
RUN pnpm run build

FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS backend-build
WORKDIR /build
COPY backend/pom.xml ./
COPY backend/src ./src
COPY --from=frontend-build /build/dist ./src/main/resources/static
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -DskipTests package

FROM --platform=$BUILDPLATFORM node:24-alpine AS gateway-assets
WORKDIR /build
COPY deploy/gateway/package.json deploy/gateway/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY deploy/gateway/build.mjs ./
COPY deploy/gateway/src ./src
COPY deploy/gateway/public ./public
RUN npm run build

# Reused by the prebuilt-JAR installer; this target never builds Java or the UI.
FROM eclipse-temurin:21-jre-alpine AS runtime-base
RUN apk add --no-cache curl nginx gettext ca-certificates su-exec \
    && addgroup -S -g 10001 oneflight \
    && adduser -S -D -H -u 10001 -G oneflight oneflight \
    && mkdir -p /app/uploads /opt/oneflight /etc/nginx/oneflight /usr/share/nginx/oneflight \
    && chown -R oneflight:oneflight /app
WORKDIR /app
COPY --from=gateway-assets /build/dist /usr/share/nginx/oneflight
COPY deploy/gateway/nginx /etc/nginx/oneflight
COPY deploy/gateway/entrypoint.sh /opt/oneflight-gateway.sh
COPY deploy/bundled/entrypoint.sh /opt/oneflight/bundled-entrypoint.sh
COPY deploy/bundled/healthcheck.sh /opt/oneflight/healthcheck.sh
RUN chmod 0755 /opt/oneflight-gateway.sh /opt/oneflight/bundled-entrypoint.sh /opt/oneflight/healthcheck.sh
EXPOSE 8080 8089
ENV TZ=Asia/Shanghai SERVER_PORT=8080 ONEFLIGHT_BUNDLED_GATEWAY_ENABLED=false
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=10 CMD /opt/oneflight/healthcheck.sh
ENTRYPOINT ["/opt/oneflight/bundled-entrypoint.sh"]

FROM runtime-base AS runtime
COPY --from=backend-build /build/target/*.jar /app/app.jar
USER oneflight

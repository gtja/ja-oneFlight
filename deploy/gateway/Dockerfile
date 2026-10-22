FROM --platform=$BUILDPLATFORM node:24-alpine AS assets
WORKDIR /build
COPY deploy/gateway/package.json deploy/gateway/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY deploy/gateway/build.mjs ./
COPY deploy/gateway/src ./src
COPY deploy/gateway/public ./public
RUN npm run build

FROM nginx:1.28-alpine
RUN apk add --no-cache ca-certificates gettext \
    && mkdir -p /etc/nginx/oneflight /usr/share/nginx/oneflight
COPY --from=assets /build/dist /usr/share/nginx/oneflight
COPY deploy/gateway/nginx /etc/nginx/oneflight
COPY deploy/gateway/entrypoint.sh /opt/oneflight-gateway.sh
RUN chmod 0755 /opt/oneflight-gateway.sh
EXPOSE 80 443 8080 8089
ENTRYPOINT ["/opt/oneflight-gateway.sh"]

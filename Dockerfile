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

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl && addgroup -S oneflight && adduser -S -G oneflight oneflight
WORKDIR /app
COPY --from=backend-build /build/target/*.jar /app/app.jar
RUN mkdir -p /app/uploads && chown -R oneflight:oneflight /app
USER oneflight
EXPOSE 8080
ENV TZ=Asia/Shanghai SERVER_PORT=8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=10 CMD curl --fail --silent http://127.0.0.1:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]

FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl && addgroup -S oneflight && adduser -S -G oneflight oneflight
WORKDIR /app
COPY --from=build /build/target/*.jar /app/app.jar
RUN mkdir -p /app/uploads && chown -R oneflight:oneflight /app
USER oneflight
EXPOSE 8080
ENV TZ=Asia/Shanghai
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]

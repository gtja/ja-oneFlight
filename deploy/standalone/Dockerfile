# The build context supplies the combined application and an uploads snapshot.
# All runtime settings are supplied by start.sh through container environment.
ARG RUNTIME_IMAGE=oneflight-runtime-base:bundle-builder
FROM ${RUNTIME_IMAGE}

USER root

ARG TARGETARCH
RUN test "$TARGETARCH" = amd64 \
    && mkdir -p /app/uploads /opt/oneflight

ENV TZ=Asia/Shanghai SERVER_PORT=8080 UPLOAD_DIRECTORY=/app/uploads
WORKDIR /app
COPY app.jar /app/app.jar
COPY uploads.tar.gz /tmp/oneflight-uploads.tar.gz
COPY entrypoint.sh /opt/oneflight/entrypoint.sh

# Seed files become part of the image. Runtime restarts never extract them
# again, so newly uploaded files remain in the existing container filesystem.
RUN tar -xzf /tmp/oneflight-uploads.tar.gz --no-same-owner -C /app/uploads \
    && rm /tmp/oneflight-uploads.tar.gz \
    && chown -R 10001:10001 /app/uploads \
    && chmod 0755 /app/uploads /opt/oneflight/entrypoint.sh \
    && chmod 0644 /app/app.jar

EXPOSE 8080 8089
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=6 \
    CMD /opt/oneflight/healthcheck.sh
ENTRYPOINT ["/opt/oneflight/entrypoint.sh"]

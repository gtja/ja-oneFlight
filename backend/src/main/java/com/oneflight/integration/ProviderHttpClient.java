package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Only fixed, read-only provider operations are exposed. Redirects are never followed. */
@Component
public class ProviderHttpClient {
    private static final int RESPONSE_LIMIT = 2 * 1024 * 1024;
    private final SourceProperties properties;
    private final HttpClient http;
    public ProviderHttpClient(SourceProperties properties) {
        this.properties = properties;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(properties.timeoutSeconds()))
                .followRedirects(HttpClient.Redirect.NEVER).build();
    }
    public JsonNode gateway(String path, Map<String, Object> body) {
        if (!properties.gatewayConfigured()) { throw ProviderJson.failure("设备来源账号尚未配置"); }
        if (!path.matches("/(device/list/tree/v4|device/detail/v3|device/list/v3|v3/dji/waylines/task/template/(list|info))")) {
            throw new IllegalArgumentException("Unsupported provider read operation");
        }
        String base = properties.gatewayOrigin() + "/proxyApi/otherService/"
                + properties.gatewaySystem() + "/controlServer";
        return read(base + path, body, Map.of("Authorization", "Bearer " + properties.token(),
                "_origin_target_host", properties.targetHost(), "Accept-Language", "zh"));
    }
    public JsonNode algorithm(String path, Map<String, Object> body) {
        if (!path.matches("/algorithm/(app/(list|statistics|tag/statistics)|deploy/device/list)(\\?[^#]*)?")) {
            throw new IllegalArgumentException("Unsupported algorithm read operation");
        }
        Map<String, String> headers = Map.of();
        if (path.startsWith("/algorithm/deploy/device/list")) {
            if (properties.username() == null || properties.username().isBlank()) {
                throw ProviderJson.failure("算法部署查询的来源账号未配置");
            }
            headers = Map.of("username", properties.username());
        }
        return read(properties.algorithmOrigin() + path, body, headers);
    }
    private JsonNode read(String url, Map<String, Object> body, Map<String, String> headers) {
        try {
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(properties.timeoutSeconds())).header("Accept", "application/json");
            headers.forEach(request::header);
            if (body == null) { request.GET(); }
            else {
                request.header("Content-Type", "application/json");
                request.POST(HttpRequest.BodyPublishers.ofString(ProviderJson.JSON.writeValueAsString(body), StandardCharsets.UTF_8));
            }
            java.util.concurrent.CompletableFuture<HttpResponse<byte[]>> pending = http.sendAsync(
                    request.build(), info -> new LimitedBodySubscriber(RESPONSE_LIMIT));
            HttpResponse<byte[]> response;
            try {
                response = pending.get(properties.timeoutSeconds(), java.util.concurrent.TimeUnit.SECONDS);
            } catch (Exception e) {
                pending.cancel(true);
                throw e;
            }
            if (response.statusCode() != 200) { throw ProviderJson.failure("来源服务响应异常或账号已失效"); }
            return ProviderJson.envelope(new String(response.body(), StandardCharsets.UTF_8));
        } catch (com.oneflight.common.ApiException e) { throw e; }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw ProviderJson.failure("来源读取被中断");
        } catch (java.util.concurrent.ExecutionException e) {
            if (e.getCause() instanceof com.oneflight.common.ApiException api) { throw api; }
            throw ProviderJson.failure("来源连接失败或读取超时");
        } catch (Exception e) { throw ProviderJson.failure("来源连接失败或读取超时"); }
    }
    /** Enforces the size budget while streaming, before buffering a complete response. */
    static final class LimitedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final java.util.concurrent.CompletableFuture<byte[]> body = new java.util.concurrent.CompletableFuture<>();
        private final java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        private final int limit;
        private java.util.concurrent.Flow.Subscription subscription;
        LimitedBodySubscriber(int limit) { this.limit = limit; }
        @Override public java.util.concurrent.CompletionStage<byte[]> getBody() { return body; }
        @Override public void onSubscribe(java.util.concurrent.Flow.Subscription value) {
            subscription = value; subscription.request(1);
        }
        @Override public void onNext(java.util.List<java.nio.ByteBuffer> chunks) {
            for (java.nio.ByteBuffer chunk : chunks) {
                if (chunk.remaining() > limit - bytes.size()) {
                    subscription.cancel(); body.completeExceptionally(ProviderJson.failure("来源返回数据超过读取限制")); return;
                }
                byte[] part = new byte[chunk.remaining()]; chunk.get(part); bytes.writeBytes(part);
            }
            subscription.request(1);
        }
        @Override public void onError(Throwable error) { body.completeExceptionally(error); }
        @Override public void onComplete() { body.complete(bytes.toByteArray()); }
    }

}

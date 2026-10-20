package com.oneflight.integration;

import com.oneflight.common.ApiException;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ProviderTransportTest {
    @Test void deadlineIncludesSlowResponseBodyAfterHeadersHaveArrived() throws Exception {
        var executor = java.util.concurrent.Executors.newCachedThreadPool();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(executor);
        server.createContext("/algorithm/app/list", exchange -> {
            try {
                exchange.sendResponseHeaders(200, 0);
                exchange.getResponseBody().write("{\"code\":\"SUCCESS\",\"data\":".getBytes(StandardCharsets.UTF_8));
                exchange.getResponseBody().flush();
                Thread.sleep(2500);
                exchange.getResponseBody().write("{\"rows\":[],\"total\":0}}".getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) { }
            finally { exchange.close(); }
        });
        server.start();
        try {
            var properties = new SourceProperties(null, null, null, null, null, null, null, null,
                    null, null, null, null, null, null, "http://127.0.0.1:" + server.getAddress().getPort(), 1);
            Instant before = Instant.now();
            ApiException failure = assertThrows(ApiException.class, () -> new ProviderHttpClient(properties).algorithm("/algorithm/app/list", Map.of()));
            assertEquals("SOURCE_UNAVAILABLE", failure.getCode());
            assertTrue(Duration.between(before, Instant.now()).toMillis() < 2200, "The deadline must include the streamed response body");
        } finally { server.stop(0); executor.shutdownNow(); }
    }
    @Test void responseBudgetStopsReadingBeforeAnOversizedPayloadIsBuffered() {
        var subscriber = new ProviderHttpClient.LimitedBodySubscriber(4);
        var subscription = new java.util.concurrent.Flow.Subscription() {
            boolean canceled;
            public void request(long amount) { }
            public void cancel() { canceled = true; }
        };
        subscriber.onSubscribe(subscription);
        subscriber.onNext(List.of(java.nio.ByteBuffer.wrap(new byte[5])));
        assertTrue(subscription.canceled);
        assertThrows(java.util.concurrent.CompletionException.class, () -> subscriber.getBody().toCompletableFuture().join());
    }
}

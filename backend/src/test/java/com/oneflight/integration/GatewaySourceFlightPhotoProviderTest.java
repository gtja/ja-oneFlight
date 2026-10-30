package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class GatewaySourceFlightPhotoProviderTest {
    private static final String CAPTURE_PATH = "/DBApiServer/api/platformCapturePost";

    @Test
    void sendsFixedReadOnlyPhotoQueryAndParsesSuccessDataResponse() throws Exception {
        AtomicReference<String> requestPath = new AtomicReference<>();
        AtomicReference<String> requestBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/proxyApi/otherService/jingqi" + CAPTURE_PATH, exchange -> {
            requestPath.set(exchange.getRequestURI().getPath());
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] response = """
                    {"success":true,"data":[[{"id":42,"sourceId":"PHOTOGRAPH","type":"PICTURE",
                    "deviceId":"device-external-1","actionId":77,"actionItemId":8,
                    "startTime":"2026-10-29 08:00:00","endTime":"2026-10-29 08:00:00",
                    "bid":"source-bid-1","photoType":"可见光","url":"/ja-media-storage/demo/photo.jpg"}]]}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try {
            ProviderHttpClient http = new ProviderHttpClient(properties(server, true));
            GatewaySourceFlightPhotoProvider provider = new GatewaySourceFlightPhotoProvider(http, CAPTURE_PATH);
            var result = provider.list("device-external-1", Instant.parse("2026-10-29T00:00:00Z"), Instant.parse("2026-10-30T00:00:00Z"));

            JsonNode body = ProviderJson.JSON.readTree(requestBody.get());
            assertEquals("/proxyApi/otherService/jingqi" + CAPTURE_PATH, requestPath.get());
            assertEquals("Bearer synthetic-service-token", authorization.get());
            assertEquals("device-external-1", body.path("deviceId").asText());
            assertEquals("PICTURE", body.path("type").asText());
            assertEquals("ALL", body.path("sourceId").asText());
            assertEquals("2026-10-29 08:00:00", body.path("startTime").asText());
            assertEquals("2026-10-30 08:00:00", body.path("endTime").asText());
            assertEquals(1, body.path("page").asInt());
            assertEquals(9, body.path("pageSize").asInt());
            assertEquals(1, result.size());
            assertEquals("42", result.getFirst().sourceMediaId());
            assertEquals("77", result.getFirst().sourceActionId());
            assertEquals("source-bid-1", result.getFirst().sourceBid());
            assertEquals("/ja-media-storage/demo/photo.jpg", result.getFirst().sourcePath());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsUnapprovedProviderOperationsAndUnsafeImagePaths() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        try {
            ProviderHttpClient http = new ProviderHttpClient(properties(server, true));
            assertThrows(IllegalArgumentException.class, () -> http.flightPhotos(
                    "/DBApiServer/api/otherOperation", Map.of()));
            assertThrows(com.oneflight.common.ApiException.class,
                    () -> http.sourceImage("/ja-media-storage/../../private.jpg"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void imageReadUsesTheFixedSourceAndAcceptsOnlyRelativeStoragePath() throws Exception {
        byte[] jpeg = {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 0, 1, 2, 3, 4, 5, 6, 7, 8};
        AtomicReference<String> requestPath = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/ja-media-storage/demo/photo.jpg", exchange -> {
            requestPath.set(exchange.getRequestURI().getPath());
            exchange.sendResponseHeaders(200, jpeg.length);
            exchange.getResponseBody().write(jpeg);
            exchange.close();
        });
        server.start();
        try {
            ProviderHttpClient http = new ProviderHttpClient(properties(server, true));
            assertArrayEquals(jpeg, http.sourceImage("/ja-media-storage/demo/photo.jpg"));
            assertEquals("/ja-media-storage/demo/photo.jpg", requestPath.get());
        } finally {
            server.stop(0);
        }
    }

    private static SourceProperties properties(HttpServer server, boolean configured) {
        String token = configured ? "synthetic-service-token" : null;
        String origin = "http://127.0.0.1:" + server.getAddress().getPort();
        String targetHost = "127.0.0.1:" + server.getAddress().getPort();
        return new SourceProperties(origin, "jingqi", targetHost, token, null,
                null, null, null, null, null, null, null, null, null, null, 2);
    }
}

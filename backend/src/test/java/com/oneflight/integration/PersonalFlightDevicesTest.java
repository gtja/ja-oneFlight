package com.oneflight.integration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.common.ApiException;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class PersonalFlightDevicesTest {
    @Test void lookupUsesThePersonsCredentialAndFixedTargetEvenWhenServiceTokenExists() throws Exception {
        var authorization = new AtomicReference<String>();
        var target = new AtomicReference<String>();
        var method = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/proxyApi/otherService/jingqi/controlServer/device/list/tree/v4", request -> {
            authorization.set(request.getRequestHeaders().getFirst("Authorization"));
            target.set(request.getRequestHeaders().getFirst("_origin_target_host"));
            method.set(request.getRequestMethod());
            byte[] bytes = "{\"code\":\"SUCCESS\",\"data\":{\"roots\":[{\"deviceId\":\"source\",\"deviceType\":\"UAV\"}]}}".getBytes(StandardCharsets.UTF_8);
            request.sendResponseHeaders(200, bytes.length);
            request.getResponseBody().write(bytes); request.close();
        });
        server.start();
        try {
            var properties = new SourceProperties("http://127.0.0.1:" + server.getAddress().getPort(), "jingqi",
                    "118.31.104.96:32716", "service-token-must-not-be-used", "service-user", null, null, null,
                    null, null, null, null, null, null, null, 2);
            var devices = new PersonalFlightDevices(new ProviderHttpClient(properties));
            assertThat(devices.require("personal-token", "source").type()).isEqualTo("UAV");
            assertThat(authorization.get()).isEqualTo("Bearer personal-token");
            assertThat(target.get()).isEqualTo("118.31.104.96:32716");
            assertThat(method.get()).isEqualTo("POST");
        } finally { server.stop(0); }
    }

    @Test void missingDeviceAndMalformedDirectoryFailClosedWithoutUsingAnotherIdentity() throws Exception {
        var provider = mock(ProviderHttpClient.class);
        var devices = new PersonalFlightDevices(provider);
        when(provider.personalDeviceTree("person")).thenReturn(new ObjectMapper().readTree("{\"roots\":[]}"));
        assertThatThrownBy(() -> devices.require("person", "unseen"))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getCode()).isEqualTo("PERSONAL_FLIGHT_DEVICE_DENIED"));
        when(provider.personalDeviceTree("person")).thenReturn(new ObjectMapper().readTree("{}"));
        assertThatThrownBy(() -> devices.require("person", "source"))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getCode()).isEqualTo("SOURCE_UNAVAILABLE"));
        verify(provider, never()).gateway(anyString(), any());
    }
}

package com.oneflight.web;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.oneflight.auth.*;
import com.oneflight.common.ApiException;
import org.springframework.http.HttpStatus;
import com.oneflight.repository.UserAccountRepository;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.*;
import org.springframework.security.web.context.SecurityContextRepository;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.*;

class FourAControllerStateTest {
    @Test void httpIpLoginUsesOnlyConfiguredCallbackAndKeepsIdentityProviderHttps() throws Exception {
        var identities = mock(FourAIdentityService.class);
        when(identities.hasAdministratorBinding()).thenReturn(true);
        var properties = new FourAProperties("4a", false, "https://identity.example.test",
                "http://192.0.2.10:8088/", 8, "http-ip");
        var client = mock(FourAClient.class);
        var controller = new FourAController(properties, client, identities, mock(FourASessionService.class),
                mock(UserAccountRepository.class), mock(ScopeService.class), mock(SecurityContextRepository.class));
        var request = new MockHttpServletRequest();
        request.setServerName("untrusted.example");
        request.addHeader("Host", "untrusted.example");
        request.addParameter("fallback", "http://untrusted.example/callback");
        var response = new MockHttpServletResponse();
        controller.start(null, request, response);
        String url = response.getRedirectedUrl();
        assertThat(url).startsWith("https://identity.example.test/login?systemName=oneflight&fallback=");
        String fallback = URLDecoder.decode(url.split("fallback=")[1], StandardCharsets.UTF_8);
        assertThat(fallback).startsWith("http://192.0.2.10:8088/api/v1/auth/4a/callback?state=")
                .doesNotContain("untrusted.example");
        assertThat(response.getHeader("Referrer-Policy")).isEqualTo("no-referrer");
        verifyNoInteractions(client);
    }

    @Test void callbackStateExpiresAtFiveMinutesWithoutContactingIdentityService() throws Exception {
        FourAClient client = mock(FourAClient.class);
        var identities = mock(FourAIdentityService.class);
        when(identities.hasAdministratorBinding()).thenReturn(true);
        var properties = new FourAProperties("4a", false, "https://identity.example.test", "https://platform.example.test", 8);
        var clock = new MutableClock();
        var controller = new FourAController(properties, client, identities, mock(FourASessionService.class),
                mock(UserAccountRepository.class), mock(ScopeService.class), mock(SecurityContextRepository.class), clock);
        var request = new MockHttpServletRequest(); var start = new MockHttpServletResponse();
        controller.start(null, request, start);
        String fallback = URLDecoder.decode(start.getRedirectedUrl().split("fallback=")[1], StandardCharsets.UTF_8);
        String state = URI.create(fallback).getQuery().substring(6);
        clock.now = clock.now.plusSeconds(300);
        var callback = new MockHttpServletResponse();
        controller.callback(state, "personal-token", request, callback);
        assertThat(callback.getRedirectedUrl()).isEqualTo("https://platform.example.test/?authError=INVALID_STATE");
        assertThat(callback.getHeader("Cache-Control")).isEqualTo("no-store");
        verifyNoInteractions(client);
    }
    @Test void returnViewIsAllowlistedAndNoBrowserFallbackCanOverrideCallbackOrigin() throws Exception {
        var properties = new FourAProperties("4a", false, "https://identity.example.test", "https://platform.example.test", 8);
        var identities = mock(FourAIdentityService.class);
        var client = mock(FourAClient.class);
        var controller = new FourAController(properties, client, identities, mock(FourASessionService.class),
                mock(UserAccountRepository.class), mock(ScopeService.class), mock(SecurityContextRepository.class));
        var request = new MockHttpServletRequest();
        request.addParameter("view", "https://untrusted.example");
        request.addParameter("fallback", "https://untrusted.example/callback");
        var start = new MockHttpServletResponse(); controller.start(null, request, start);
        assertThat(start.getRedirectedUrl()).doesNotContain("untrusted.example");
        verifyNoInteractions(identities);
    }
    @Test void unexpectedValidationFailureStillRedirectsToRemoveToken() throws Exception {
        FourAClient client = mock(FourAClient.class);
        when(client.verify("personal-token", "oneflight")).thenThrow(new IllegalStateException("service error"));
        var identities = mock(FourAIdentityService.class); when(identities.hasAdministratorBinding()).thenReturn(true);
        var properties = new FourAProperties("4a", false, "https://identity.example.test", "https://platform.example.test", 8);
        var controller = new FourAController(properties, client, identities, mock(FourASessionService.class),
                mock(UserAccountRepository.class), mock(ScopeService.class), mock(SecurityContextRepository.class));
        var request = new MockHttpServletRequest(); var start = new MockHttpServletResponse(); controller.start(null, request, start);
        String fallback = URLDecoder.decode(start.getRedirectedUrl().split("fallback=")[1], StandardCharsets.UTF_8);
        var callback = new MockHttpServletResponse(); controller.callback(URI.create(fallback).getQuery().substring(6), "personal-token", request, callback);
        assertThat(callback.getRedirectedUrl()).isEqualTo("https://platform.example.test/?authError=FOUR_A_UNAVAILABLE");
        assertThat(callback.getRedirectedUrl()).doesNotContain("personal-token");
    }

    @Test void callbackDistinguishesIdentityContractAndApplicationPermissionFailuresWithoutReflectingUpstreamText() throws Exception {
        for (String code : new String[]{"FOUR_A_PROFILE_INVALID", "FOUR_A_ACCOUNT_DISABLED", "PLATFORM_NOT_OPEN", "UNTRUSTED_ERROR"}) {
            var client = mock(FourAClient.class);
            when(client.verify("personal-token", "oneflight"))
                    .thenThrow(new ApiException(HttpStatus.UNAUTHORIZED, code, "untrusted upstream personal-token"));
            var controller = new FourAController(
                    new FourAProperties("4a", false, "https://identity.example.test", "https://platform.example.test", 8),
                    client, mock(FourAIdentityService.class), mock(FourASessionService.class),
                    mock(UserAccountRepository.class), mock(ScopeService.class), mock(SecurityContextRepository.class));
            var request = new MockHttpServletRequest(); var start = new MockHttpServletResponse();
            controller.start(null, request, start);
            String fallback = URLDecoder.decode(start.getRedirectedUrl().split("fallback=")[1], StandardCharsets.UTF_8);
            var response = new MockHttpServletResponse();
            controller.callback(URI.create(fallback).getQuery().substring(6), "personal-token", request, response);
            String expected = "UNTRUSTED_ERROR".equals(code) ? "FOUR_A_UNAVAILABLE" : code;
            assertThat(response.getRedirectedUrl()).isEqualTo("https://platform.example.test/?authError=" + expected)
                    .doesNotContain("personal-token", "untrusted upstream", "UNTRUSTED_ERROR");
            assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        }
    }
    private static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-21T00:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}

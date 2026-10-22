package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.oneflight.auth.FourAClient;
import com.oneflight.auth.FourASessionService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:four-a-embedded-options;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "oneflight.auth.mode=4a",
        "oneflight.auth.local-maintenance-enabled=false",
        "oneflight.auth.four-a-origin=https://identity.example.test",
        "oneflight.auth.parent-origin=http://198.51.100.20:8088",
        "oneflight.auth.bootstrap-four-a-user-id=",
        "oneflight.transport-mode=http-ip",
        "oneflight.sources.identity-jdbc-url=",
        "FLIGHT_CONTROL_MODE=embedded",
        "FLIGHT_CONTROL_ORIGIN=http://198.51.100.20:8089",
        "ONEFLIGHT_PUBLIC_ORIGIN=http://198.51.100.20:8088",
        "FLIGHT_CONTROL_GATEWAY_SECRET=synthetic-gateway-secret-for-options-test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FourAEmbeddedOptionsIntegrationTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private FourAClient client;
    @MockitoBean private FourASessionService sessions;

    @AfterEach
    void clearSecurityContextWithoutContactingIdentityProvider() {
        verifyNoInteractions(client);
        SecurityContextHolder.clearContext();
    }

    @Test
    void anonymousLoginOptionsExposeFourAWithoutLocalPasswordLogin() throws Exception {
        mvc.perform(get("/api/v1/auth/options"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.mode").value("4a"))
                .andExpect(jsonPath("$.data.accountsMode").value("4a"))
                .andExpect(jsonPath("$.data.localLoginEnabled").value(false))
                .andExpect(jsonPath("$.data.transportMode").value("http-ip"));
    }

    @Test
    void anonymousFlightOptionsStillRequirePlatformAuthentication() throws Exception {
        mvc.perform(get("/api/v1/flight-control/options"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void authenticatedFlightOptionsExposeEmbeddedTaskEntryOnTheConfiguredPublicOrigins()
            throws Exception {
        var identity = new FourASessionService.Identity(
                "synthetic-binding", "synthetic-external-user", "synthetic-local-user",
                "synthetic-personal-token");
        when(sessions.requirePlatformIdentity(any(HttpServletRequest.class))).thenReturn(identity);

        String response = mvc.perform(get("/api/v1/flight-control/options")
                        .session(platformSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.mode").value("embedded"))
                .andExpect(jsonPath("$.data.entrySupported").value(true))
                .andExpect(jsonPath("$.data.requiresTask").value(true))
                .andExpect(jsonPath("$.data.origin").value("http://198.51.100.20:8089"))
                .andExpect(jsonPath("$.data.parentOrigin").value("http://198.51.100.20:8088"))
                .andExpect(jsonPath("$.data.transportMode").value("http-ip"))
                .andExpect(jsonPath("$.data.capabilities.microphone").value(false))
                .andExpect(jsonPath("$.data.message").isString())
                .andReturn().getResponse().getContentAsString();

        assertThat(response).doesNotContain(
                "synthetic-gateway-secret-for-options-test", "synthetic-personal-token");
        verify(sessions).requirePlatformIdentity(any(HttpServletRequest.class));
    }

    private MockHttpSession platformSession() {
        var session = new MockHttpSession();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                "synthetic-pilot", null, List.of(new SimpleGrantedAuthority("ROLE_PILOT"))));
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        return session;
    }
}

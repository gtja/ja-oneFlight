package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.FourASessionService;
import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import com.oneflight.integration.PersonalFlightDevices;
import com.oneflight.integration.SourceModels;
import java.util.Set;
import com.oneflight.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"FLIGHT_CONTROL_MODE=embedded", "FLIGHT_CONTROL_ORIGIN=https://flight.example.test",
        "ONEFLIGHT_PUBLIC_ORIGIN=https://platform.example.test", "FLIGHT_CONTROL_GATEWAY_SECRET=abcdefghijklmnopqrstuvwxyz123456"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FlightControlIntegrationTest {
    static final String SECRET = "abcdefghijklmnopqrstuvwxyz123456";
    @Autowired MockMvc mvc;
    @MockitoBean FourASessionService identities;
    @MockitoBean FlightTargetResolver targets;
    @MockitoBean FlightEntryPolicy policy;
    @MockitoBean PersonalFlightDevices personal;
    @MockitoBean FlightEntryAudit audit;
    final FlightEntryPolicy.Snapshot snapshot = new FlightEntryPolicy.Snapshot("task", "plan", "resource", "source", 0, 0, 0, "pilot", "fingerprint");
    MockHttpSession session;
    ObjectMapper json = new ObjectMapper();

    @BeforeEach void fixture() {
        session = new MockHttpSession();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated("pilot", "N/A",
                List.of(new SimpleGrantedAuthority("ROLE_PILOT"))));
        session.setAttribute("SPRING_SECURITY_CONTEXT", context);
        when(identities.requireFlightIdentity(any(jakarta.servlet.http.HttpSession.class)))
                .thenReturn(new FourASessionService.Identity("binding", "external-id", "local-id", "personal-token</script>"));
        when(identities.requireLiveIdentity(any(jakarta.servlet.http.HttpSession.class)))
                .thenAnswer(call -> identities.requireFlightIdentity(call.getArgument(0)));
        when(identities.currentUser(any())).thenReturn(new CurrentUser("local-id", "pilot", "飞手", Role.PILOT, "org", Set.of(), Set.of("resource")));
        when(policy.requireAllowed(any(), eq("task"))).thenReturn(snapshot);
        when(personal.require(anyString(), eq("source"))).thenReturn(mock(SourceModels.Device.class));
        when(targets.personalTarget(any())).thenReturn(new FlightTargetResolver.Target("/control-room/uav/source", null));
    }

    String launch() throws Exception {
        String body = mvc.perform(post("/api/v1/flight-control/launch").session(session).with(csrf())
                        .contentType("application/json").content("{\"deviceId\":\"source\",\"taskId\":\"task\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("personal-token");
        return json.readTree(body).path("data").path("url").asText().split("ticket=")[1];
    }

    @Test void launchRequiresSessionAndCsrf() throws Exception {
        mvc.perform(post("/api/v1/flight-control/launch").with(csrf()).contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/flight-control/launch").session(session).contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test void childConsumesWithoutParentCookieAndNeverAllowsReplay() throws Exception {
        String ticket = launch();
        String html = mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)
                        .header("X-Oneflight-Gateway-Secret", SECRET))
                .andExpect(status().isOk()).andExpect(header().doesNotExist("X-Frame-Options"))
                .andExpect(header().string("Cache-Control", "no-store, max-age=0"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().string("Content-Security-Policy", org.hamcrest.Matchers.containsString("frame-ancestors https://platform.example.test")))
                .andReturn().getResponse().getContentAsString();
        assertThat(html).contains("personal-token\\u003c/script\\u003e").doesNotContain("personal-token</script>", ticket);
        mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)
                        .header("X-Oneflight-Gateway-Secret", SECRET))
                .andExpect(status().isUnauthorized()).andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("personal-token"))));
    }

    @Test void gatewayHeaderIsRequiredAndFailureDoesNotConsumeTicket() throws Exception {
        String ticket = launch();
        mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)
                .header("X-Oneflight-Gateway-Secret", SECRET)).andExpect(status().isOk());
    }

    @Test void changedIdentityOrInvalidatedSessionCannotUseOutstandingLaunch() throws Exception {
        String ticket = launch();
        when(identities.requireFlightIdentity(any(jakarta.servlet.http.HttpSession.class)))
                .thenReturn(new FourASessionService.Identity("different", "external-B", "local-id", "other-token"));
        mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)
                        .header("X-Oneflight-Gateway-Secret", SECRET))
                .andExpect(status().isUnauthorized()).andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("other-token"))));
        String next = launch();
        session.invalidate();
        mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", next)
                .header("X-Oneflight-Gateway-Secret", SECRET)).andExpect(status().isUnauthorized());
    }

    @Test void noFlightPermissionDoesNotDestroyPlatformSession() throws Exception {
        when(identities.requireFlightIdentity(any(jakarta.servlet.http.HttpSession.class))).thenThrow(ApiException.forbidden());
        mvc.perform(post("/api/v1/flight-control/launch").session(session).with(csrf()).contentType("application/json").content("{\"taskId\":\"task\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/flight-control/options").session(session)).andExpect(status().isOk());
        assertThat(session.isInvalid()).isFalse();
    }

    @Test void cleanupPageContainsNoUserCredential() throws Exception {
        mvc.perform(get("/api/v1/flight-control/logout-page").header("X-Oneflight-Gateway-Secret", SECRET))
                .andExpect(status().isOk()).andExpect(content().string(org.hamcrest.Matchers.containsString("\"mode\":\"logout\"")))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("personal-token"))));
    }

    @Test void logoutWhileRemoteVerificationIsRunningCannotReturnPersonalToken() throws Exception {
        String ticket = launch();
        when(identities.requireFlightIdentity(any(jakarta.servlet.http.HttpSession.class))).thenAnswer(invocation -> {
            session.invalidate();
            return new FourASessionService.Identity("binding", "external-id", "local-id", "late-token");
        });
        mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)
                        .header("X-Oneflight-Gateway-Secret", SECRET))
                .andExpect(status().isUnauthorized()).andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("late-token"))));
    }
}

package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
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
import java.util.List;
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

@SpringBootTest(properties = {"oneflight.transport-mode=http-ip", "FLIGHT_CONTROL_MODE=embedded",
        "FLIGHT_CONTROL_ORIGIN=http://192.0.2.10:8089/", "ONEFLIGHT_PUBLIC_ORIGIN=http://192.0.2.10:8088/",
        "oneflight.auth.parent-origin=http://192.0.2.10:8088/",
        "FLIGHT_CONTROL_GATEWAY_SECRET=abcdefghijklmnopqrstuvwxyz123456"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HttpIpIntegrationTest {
    @Autowired MockMvc mvc;
    @MockitoBean FourASessionService identities;
    @MockitoBean FlightTargetResolver targets;
    @MockitoBean FlightEntryPolicy policy;
    @MockitoBean PersonalFlightDevices personal;
    @MockitoBean FlightEntryAudit audit;

    private MockHttpSession platformSession() {
        var session = new MockHttpSession();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated("pilot", "N/A",
                List.of(new SimpleGrantedAuthority("ROLE_PILOT"))));
        session.setAttribute("SPRING_SECURITY_CONTEXT", context);
        return session;
    }

    @Test void apiOptionsExposeCompatibilityAndUnavailableMicrophoneWithoutCredentials() throws Exception {
        mvc.perform(get("/api/v1/auth/options")).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.transportMode").value("http-ip"))
                .andExpect(jsonPath("$.data.mode").value("local"));
        String body = mvc.perform(get("/api/v1/flight-control/options").session(platformSession()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.mode").value("embedded"))
                .andExpect(jsonPath("$.data.origin").value("http://192.0.2.10:8089"))
                .andExpect(jsonPath("$.data.parentOrigin").value("http://192.0.2.10:8088"))
                .andExpect(jsonPath("$.data.transportMode").value("http-ip"))
                .andExpect(jsonPath("$.data.capabilities.microphone").value(false))
                .andExpect(jsonPath("$.data.message").isString()).andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("abcdefghijklmnopqrstuvwxyz123456", "token");
    }

    @Test void httpChildTicketBootstrapUsesExactParentOriginWithoutSharingCookies() throws Exception {
        when(identities.requireFlightIdentity(any(jakarta.servlet.http.HttpSession.class)))
                .thenReturn(new FourASessionService.Identity("binding", "external-id", "local-id", "personal-token"));
        when(identities.requireLiveIdentity(any(jakarta.servlet.http.HttpSession.class)))
                .thenReturn(new FourASessionService.Identity("binding", "external-id", "local-id", "personal-token"));
        when(identities.currentUser(any())).thenReturn(new CurrentUser("local-id", "pilot", "飞手", Role.PILOT, "org", Set.of(), Set.of("resource")));
        when(policy.requireAllowed(any(), eq("task"))).thenReturn(new FlightEntryPolicy.Snapshot("task", "plan", "resource", "source", 0, 0, 0, "pilot", "fingerprint"));
        when(personal.require(anyString(), eq("source"))).thenReturn(mock(SourceModels.Device.class));
        when(targets.personalTarget(any())).thenReturn(new FlightTargetResolver.Target("/control-room/uav/source", null));
        String launch = mvc.perform(post("/api/v1/flight-control/launch").session(platformSession()).with(csrf())
                        .contentType("application/json").content("{\"deviceId\":\"source\",\"taskId\":\"task\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String launchUrl = new ObjectMapper().readTree(launch).path("data").path("url").asText();
        assertThat(launchUrl).startsWith("http://192.0.2.10:8089/__oneflight/bootstrap?ticket=");
        String ticket = launchUrl.split("ticket=")[1];
        String html = mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)
                        .header("X-Oneflight-Gateway-Secret", "abcdefghijklmnopqrstuvwxyz123456"))
                .andExpect(status().isOk()).andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.allOf(org.hamcrest.Matchers.containsString("ONEFLIGHT_ENTRY="), org.hamcrest.Matchers.containsString("HttpOnly"), org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Secure")))))
                .andExpect(header().doesNotExist("X-Frame-Options"))
                .andExpect(header().string("Content-Security-Policy", org.hamcrest.Matchers.containsString("frame-ancestors http://192.0.2.10:8088")))
                .andReturn().getResponse().getContentAsString();
        assertThat(html).contains("\"transportMode\":\"http-ip\"", "\"parentOrigin\":\"http://192.0.2.10:8088\"");
        mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)
                        .header("X-Oneflight-Gateway-Secret", "abcdefghijklmnopqrstuvwxyz123456"))
                .andExpect(status().isUnauthorized());
    }
}

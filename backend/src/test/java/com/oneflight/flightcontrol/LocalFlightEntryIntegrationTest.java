package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.oneflight.auth.FourAClient;
import com.oneflight.auth.Role;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.UserAccountRepository;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"FLIGHT_CONTROL_MODE=embedded", "FLIGHT_CONTROL_ORIGIN=https://flight.example.test",
        "ONEFLIGHT_PUBLIC_ORIGIN=https://platform.example.test", "FLIGHT_CONTROL_GATEWAY_SECRET=abcdefghijklmnopqrstuvwxyz123456"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LocalFlightEntryIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired UserAccountRepository users;
    @Autowired PasswordEncoder encoder;
    @MockitoBean FourAClient client;
    @MockitoBean FlightTargetResolver targets;
    UserAccount account;

    @BeforeEach void fixture() {
        account = new UserAccount(); account.username = "local-flight-" + UUID.randomUUID();
        account.displayName = "本地飞手"; account.passwordHash = encoder.encode("test-password");
        account.role = Role.PILOT; account.organizationId = UUID.randomUUID().toString();
        account = users.saveAndFlush(account);
    }
    @AfterEach void cleanup() {
        users.deleteById(account.id);
        SecurityContextHolder.clearContext();
    }

    private MockHttpSession login() throws Exception {
        var result = mvc.perform(post("/api/v1/auth/login").with(csrf()).contentType("application/json")
                        .content("{\"username\":\"" + account.username + "\",\"password\":\"test-password\"}"))
                .andExpect(status().isOk()).andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }

    @Test void launchDeniesOnlyFlightEntryAndPreservesLocalBusinessSession() throws Exception {
        var session = login();
        mvc.perform(post("/api/v1/flight-control/launch").session(session).with(csrf())
                        .contentType("application/json").content("{\"taskId\":\"task\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FOUR_A_LOGIN_REQUIRED"));
        assertThat(session.isInvalid()).isFalse();
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(account.id));
        verifyNoInteractions(client, targets);
    }

    @Test void disabledLocalAccountCannotKeepUsingTheSessionOrReceiveFriendlyFlightDenial() throws Exception {
        var session = login(); account.enabled = false; users.saveAndFlush(account);
        mvc.perform(post("/api/v1/flight-control/launch").session(session).with(csrf())
                        .contentType("application/json").content("{\"taskId\":\"task\"}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("FOUR_A_SESSION_EXPIRED"));
        assertThat(session.isInvalid()).isTrue();
        mvc.perform(get("/api/v1/auth/me")).andExpect(status().isUnauthorized());
        verifyNoInteractions(client, targets);
    }
}

package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;

class FlightEntryGrantsTest {
    private final FlightEntryGrants grants = new FlightEntryGrants();

    private MockHttpSession session() {
        var session = new MockHttpSession();
        session.setAttribute("SPRING_SECURITY_CONTEXT", new Object());
        return session;
    }

    @Test void grantContainsOnlyAnOpaqueCredentialAndRemainsReusableForStreams() {
        var session = session();
        String key = grants.issue(session, "identity", "user", "task");
        assertThat(key).matches("[A-Za-z0-9_-]{43}");
        assertThat(grants.require(key).taskId()).isEqualTo("task");
        assertThat(grants.require(key).toString()).isEqualTo("FlightEntryGrant[redacted]");
        assertThat(grants.require(key).session()).isSameAs(session);
        // Entering a second tab must not revoke a stream already using the previous credential.
        grants.issue(session, "identity", "user", "another-task");
        assertThat(grants.require(key).taskId()).isEqualTo("task");
    }

    @Test void logoutRevokesAllGrantsForOnlyTheOwningSession() {
        var first = session(); var second = session();
        String a = grants.issue(first, "A", "A", "task-A");
        String b = grants.issue(first, "A", "A", "task-B");
        String c = grants.issue(second, "B", "B", "task-C");
        grants.revoke(first);
        assertThatThrownBy(() -> grants.require(a)).hasMessageContaining("放行");
        assertThatThrownBy(() -> grants.require(b)).hasMessageContaining("放行");
        assertThat(grants.require(c).localUserId()).isEqualTo("B");
    }

    @Test void invalidatedOrRotatedParentSessionCannotContinue() {
        var session = session(); String key = grants.issue(session, "A", "A", "task");
        session.changeSessionId();
        assertThatThrownBy(() -> grants.require(key)).hasMessageContaining("放行");
        String next = grants.issue(session, "A", "A", "task");
        session.invalidate();
        assertThatThrownBy(() -> grants.require(next)).hasMessageContaining("放行");
    }

    @Test void malformedNativeCookieIsNeverAnEntryGrant() {
        for (String key : new String[] {"", "personal-token", "A".repeat(1000), "../ticket"}) {
            assertThatThrownBy(() -> grants.require(key)).hasMessageContaining("放行");
        }
        assertThatThrownBy(() -> grants.require(null)).hasMessageContaining("放行");
    }
}

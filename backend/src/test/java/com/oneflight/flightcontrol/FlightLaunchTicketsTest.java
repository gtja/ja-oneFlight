package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;

import java.time.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;

class FlightLaunchTicketsTest {
    private final MutableClock clock = new MutableClock();
    private final FlightLaunchTickets tickets = new FlightLaunchTickets(clock);
    private final FlightTargetResolver.Target target = new FlightTargetResolver.Target("/control-room", null);

    private MockHttpSession session() {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("SPRING_SECURITY_CONTEXT", new Object());
        return session;
    }

    @Test void expiresAtExactlySixtySeconds() {
        String ticket = tickets.issue(session(), "identity", "user", target, null);
        clock.now = clock.now.plusSeconds(60);
        assertThatThrownBy(() -> tickets.consume(ticket)).hasMessageContaining("失效");
    }

    @Test void consumptionIsAtomicUnderConcurrentRequests() throws Exception {
        String ticket = tickets.issue(session(), "identity", "user", target, null);
        AtomicInteger successes = new AtomicInteger();
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var work = new java.util.ArrayList<Future<?>>();
            for (int i = 0; i < 20; i++) work.add(executor.submit(() -> {
                try { tickets.consume(ticket); successes.incrementAndGet(); } catch (RuntimeException expected) { }
            }));
            for (var future : work) future.get();
        }
        assertThat(successes.get()).isEqualTo(1);
    }

    @Test void invalidatedOrRotatedSessionCannotLaunch() {
        MockHttpSession parent = session();
        String ticket = tickets.issue(parent, "identity", "user", target, null);
        parent.changeSessionId();
        assertThatThrownBy(() -> tickets.consume(ticket)).hasMessageContaining("失效");
        String next = tickets.issue(parent, "identity", "user", target, null);
        parent.invalidate();
        assertThatThrownBy(() -> tickets.consume(next)).hasMessageContaining("失效");
    }

    @Test void newLaunchAndLogoutRevokeOlderTicketsWithoutAffectingOtherSessions() {
        MockHttpSession parent = session();
        String first = tickets.issue(parent, "identity", "user", target, null);
        String second = tickets.issue(parent, "identity", "user", target, null);
        String other = tickets.issue(session(), "other", "otherUser", target, null);
        assertThatThrownBy(() -> tickets.consume(first)).hasMessageContaining("失效");
        tickets.revoke(parent);
        assertThatThrownBy(() -> tickets.consume(second)).hasMessageContaining("失效");
        assertThat(tickets.consume(other).localUserId()).isEqualTo("otherUser");
    }

    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-21T00:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}

package com.oneflight.flightcontrol;

import com.oneflight.common.ApiException;
import jakarta.servlet.http.HttpSession;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Opaque, single-use credentials for the existing single-instance HttpSession deployment. */
@Service
public class FlightLaunchTickets {
    private final ConcurrentHashMap<String, Ticket> tickets = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final Clock clock;

    public FlightLaunchTickets() { this(Clock.systemUTC()); }
    FlightLaunchTickets(Clock clock) { this.clock = clock; }

    public synchronized String issue(HttpSession session, String identityId, String localUserId,
            FlightTargetResolver.Target target, FlightEntryPolicy.Snapshot snapshot) {
        prune();
        // One outstanding launch per parent session prevents unbounded growth and stale account entry.
        tickets.entrySet().removeIf(entry -> entry.getValue().session() == session);
        if (tickets.size() >= 10_000) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "LAUNCH_BUSY", "飞控启动繁忙，请稍后重试");
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String key = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        tickets.put(key, new Ticket(session, session.getId(), identityId, localUserId,
                target, snapshot, clock.instant().plusSeconds(60)));
        return key;
    }

    public Ticket consume(String key) {
        Ticket ticket = key == null || key.length() != 43 ? null : tickets.remove(key);
        if (ticket == null || !clock.instant().isBefore(ticket.expiresAt())) throw invalid();
        requireLiveSession(ticket);
        return ticket;
    }

    void requireLiveSession(Ticket ticket) {
        try {
            if (!ticket.sessionId().equals(ticket.session().getId())
                    || ticket.session().getAttribute("SPRING_SECURITY_CONTEXT") == null) throw invalid();
        } catch (IllegalStateException e) { throw invalid(); }
    }

    public void revoke(HttpSession session) {
        tickets.entrySet().removeIf(entry -> entry.getValue().session() == session);
    }

    private void prune() {
        Instant now = clock.instant();
        tickets.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expiresAt()));
    }

    static ApiException invalid() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "LAUNCH_EXPIRED", "启动票据已失效，请重新进入飞控");
    }

    // Do not add token fields or an automatically generated toString containing credentials.
    public record Ticket(HttpSession session, String sessionId, String identityId, String localUserId,
            FlightTargetResolver.Target target, FlightEntryPolicy.Snapshot entry, Instant expiresAt) {
        @Override public String toString() { return "FlightLaunchTicket[redacted]"; }
    }
}

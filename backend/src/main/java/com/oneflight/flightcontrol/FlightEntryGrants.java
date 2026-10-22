package com.oneflight.flightcontrol;

import com.oneflight.common.ApiException;
import jakarta.servlet.http.HttpSession;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Continuation credentials expire with the owning login, never with a business task's window. */
@Service
public class FlightEntryGrants {
    public static final String COOKIE = "ONEFLIGHT_ENTRY";
    private final ConcurrentHashMap<String, Grant> grants = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    public synchronized String issue(HttpSession session, String identityId, String userId, String taskId) {
        grants.entrySet().removeIf(entry -> !live(entry.getValue()));
        if (grants.size() >= 10_000) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ENTRY_BUSY", "飞控启动繁忙，请稍后重试");
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String key = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        var grant = new Grant(session, session.getId(), identityId, userId, taskId);
        if (!live(grant)) throw invalid();
        grants.put(key, grant);
        return key;
    }

    public Grant require(String key) {
        if (key == null || !key.matches("[A-Za-z0-9_-]{43}")) throw invalid();
        Grant grant = grants.get(key);
        if (grant == null || !live(grant)) {
            if (grant != null) grants.remove(key, grant);
            throw invalid();
        }
        return grant;
    }

    public void revoke(HttpSession session) {
        grants.entrySet().removeIf(entry -> entry.getValue().session() == session);
    }
    public void revoke(String key) { if (key != null) grants.remove(key); }

    private static boolean live(Grant grant) {
        try {
            return grant.sessionId().equals(grant.session().getId())
                    && grant.session().getAttribute("SPRING_SECURITY_CONTEXT") != null
                    && (grant.session().getMaxInactiveInterval() <= 0
                    || System.currentTimeMillis() - grant.session().getLastAccessedTime()
                    < grant.session().getMaxInactiveInterval() * 1000L);
        } catch (IllegalStateException e) { return false; }
    }
    static ApiException invalid() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "FLIGHT_ENTRY_REQUIRED", "请返回一网统飞选择执行任务并完成放行检查");
    }
    public record Grant(HttpSession session, String sessionId, String identityId, String localUserId, String taskId) {
        @Override public String toString() { return "FlightEntryGrant[redacted]"; }
    }
}

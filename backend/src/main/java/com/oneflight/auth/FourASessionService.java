package com.oneflight.auth;

import com.oneflight.common.ApiException;
import com.oneflight.domain.ExternalIdentity;
import com.oneflight.repository.*;
import jakarta.servlet.http.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.*;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.Objects;

/** Personal tokens live only in the owning, server-side HttpSession. */
@Service
public class FourASessionService {
    static final String ATTRIBUTE = FourASessionService.class.getName() + ".identity";
    public static final String LOCAL_MAINTENANCE = FourASessionService.class.getName() + ".maintenance";
    private final FourAClient client;
    private final FourAProperties properties;
    private final ExternalIdentityRepository identities;
    private final UserAccountRepository users;
    private final FourAIdentityService projections;
    public record Identity(String identityId, String immutableUserId, String localUserId,
            @com.fasterxml.jackson.annotation.JsonIgnore String token) {
        @Override public String toString() { return "FourAIdentity[redacted]"; }
    }
    private static class State {
        final Identity identity;
        final String bindingRevision;
        volatile long verifiedAt = 0;
        State(Identity identity, String revision) { this.identity = identity; this.bindingRevision = revision; this.verifiedAt = Instant.now().toEpochMilli(); }
        @Override public String toString() { return "FourASession[redacted]"; }
    }
    @org.springframework.beans.factory.annotation.Autowired
    public FourASessionService(FourAClient client, FourAProperties properties, ExternalIdentityRepository identities,
            UserAccountRepository users, FourAIdentityService projections) {
        this.client = client; this.properties = properties; this.identities = identities; this.users = users;
        this.projections = projections;
    }
    FourASessionService(FourAClient client, FourAProperties properties, ExternalIdentityRepository identities, UserAccountRepository users) {
        this(client, properties, identities, users, null);
    }
    public void establish(HttpSession session, ExternalIdentity identity, String token) {
        session.setAttribute(ATTRIBUTE, new State(new Identity(identity.id, identity.externalUserId, identity.userId, token), identity.bindingRevision));
    }
    public Identity requirePlatformIdentity(HttpServletRequest request) { return requirePlatformIdentity(request.getSession(false)); }
    /** Local liveness only: streaming requests must not re-run business entry rules or remote I/O. */
    public Identity requireLiveIdentity(HttpSession session) {
        try {
            if (session == null || !(session.getAttribute(ATTRIBUTE) instanceof State state)) throw FourAClient.expired();
            requireLiveState(session, state);
            return state.identity;
        } catch (IllegalStateException e) { throw FourAClient.expired(); }
    }
    /** Explicit principal for the child-origin, stateless bootstrap and gateway checks. */
    public CurrentUser currentUser(Identity identity) {
        var user = users.findById(identity.localUserId()).filter(u -> u.enabled).orElseThrow(FourAClient::expired);
        return projections == null ? user.current() : projections.currentView(user);
    }
    public Identity requirePlatformIdentity(HttpSession session) {
        try {
            if (session == null || !(session.getAttribute(ATTRIBUTE) instanceof State state)) throw FourAClient.expired();
            requireLiveState(session, state);
            if (Instant.now().toEpochMilli() - state.verifiedAt >= 30_000L) {
                synchronized (state) {
                    if (Instant.now().toEpochMilli() - state.verifiedAt >= 30_000L) {
                        var verified = client.verify(state.identity.token(), "oneflight");
                        if (!state.identity.immutableUserId().equals(verified.userId())) throw FourAClient.expired();
                        if (projections != null) projections.synchronize(verified);
                        state.verifiedAt = Instant.now().toEpochMilli();
                    }
                }
                // The external request (or waiting for another request's verification) may
                // outlive logout, local disable or revision. Its success cannot restore access.
                requireLiveState(session, state);
            }
            return state.identity;
        } catch (IllegalStateException e) { invalidate(session); throw FourAClient.expired(); }
        catch (ApiException e) {
            if (e.getStatus() == HttpStatus.UNAUTHORIZED) invalidate(session);
            throw e;
        }
    }
    private void requireLiveState(HttpSession session, State state) {
        if (session.getAttribute(ATTRIBUTE) != state) throw FourAClient.expired();
        var binding = identities.findById(state.identity.identityId()).filter(i -> properties.issuer.equals(i.issuer)
                && Objects.equals(i.externalUserId, state.identity.immutableUserId())
                && Objects.equals(i.userId, state.identity.localUserId())
                && Objects.equals(i.bindingRevision, state.bindingRevision)).orElseThrow(FourAClient::expired);
        var user = users.findById(binding.userId).filter(u -> u.enabled).orElseThrow(FourAClient::expired);
        Object context = session.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        if (!(context instanceof SecurityContext security) || security.getAuthentication() == null
                || !security.getAuthentication().isAuthenticated()
                || !user.username.equals(security.getAuthentication().getName())) throw FourAClient.expired();
    }
    public Identity requireFlightIdentity(HttpSession session) {
        requireFlightSsoForLocalSession(session);
        Identity identity = requirePlatformIdentity(session);
        FourAClient.Profile platform;
        try { platform = client.verify(identity.token(), "oneflight"); }
        catch (ApiException e) { if (e.getStatus() == HttpStatus.UNAUTHORIZED) invalidate(session); throw e; }
        if (!identity.immutableUserId().equals(platform.userId())) { invalidate(session); throw FourAClient.expired(); }
        if (projections != null) projections.synchronize(platform);
        FourAClient.Profile flight;
        try { flight = client.verify(identity.token(), "jingqi"); }
        catch (ApiException e) { if (e.getStatus() == HttpStatus.UNAUTHORIZED) invalidate(session); throw e; }
        if (!identity.immutableUserId().equals(flight.userId())) throw new ApiException(HttpStatus.FORBIDDEN, "FLIGHT_IDENTITY_MISMATCH", "飞控身份不匹配，请重新登录");
        // Verification performs external I/O; administrators may revoke this binding or disable
        // the local account while it is in flight. Re-read the live session and database last.
        if (!identity.equals(requirePlatformIdentity(session))) { invalidate(session); throw FourAClient.expired(); }
        return identity;
    }
    private void requireFlightSsoForLocalSession(HttpSession session) {
        try {
            // A local business login has no personal upstream token. Deny this entry without
            // treating its otherwise valid platform session as an expired 4A session.
            if (session == null || session.getAttribute(ATTRIBUTE) != null
                    || (properties.isFourA() && !isMaintenance(session))) return;
            Object context = session.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
            if (!(context instanceof SecurityContext security) || security.getAuthentication() == null
                    || !security.getAuthentication().isAuthenticated()
                    || "anonymousUser".equals(security.getAuthentication().getName())
                    || users.findByUsername(security.getAuthentication().getName()).filter(user -> user.enabled).isEmpty()) {
                invalidate(session);
                throw FourAClient.expired();
            }
            throw new ApiException(HttpStatus.FORBIDDEN, "FOUR_A_LOGIN_REQUIRED", "请使用 4A 统一登录后，再进入飞控");
        } catch (IllegalStateException e) {
            throw FourAClient.expired();
        }
    }
    public boolean isMaintenance(HttpSession session) {
        try { return session != null && properties.localLoginEnabled() && Boolean.TRUE.equals(session.getAttribute(LOCAL_MAINTENANCE)); }
        catch (IllegalStateException e) { return false; }
    }
    public boolean logout(HttpSession session) {
        String token = null;
        try { if (session != null && session.getAttribute(ATTRIBUTE) instanceof State state) token = state.identity.token(); }
        catch (IllegalStateException ignored) { }
        invalidate(session);
        return token == null || client.logout(token);
    }
    public void invalidate(HttpSession session) {
        try { if (session != null) session.invalidate(); } catch (IllegalStateException ignored) { }
        SecurityContextHolder.clearContext();
    }
}

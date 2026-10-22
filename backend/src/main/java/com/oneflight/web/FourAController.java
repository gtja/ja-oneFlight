package com.oneflight.web;

import com.oneflight.auth.*;
import com.oneflight.common.*;
import com.oneflight.repository.UserAccountRepository;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/auth")
public class FourAController {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(FourAController.class);
    private static final Set<String> CALLBACK_ERRORS = Set.of("FOUR_A_UNAVAILABLE", "FOUR_A_SESSION_EXPIRED",
            "FOUR_A_PROFILE_INVALID", "FOUR_A_ACCOUNT_DISABLED", "PLATFORM_NOT_OPEN");
    private static final String STATE_KEY = FourAController.class.getName() + ".state";
    private final FourAProperties properties;
    private final FourAClient client;
    private final FourAIdentityService identities;
    private final FourASessionService sessions;
    private final UserAccountRepository users;
    private final ScopeService scope;
    private final SecurityContextRepository contexts;
    private final Clock clock;
    private record Pending(String value, Instant expires, String returnQuery) {}

    @Autowired public FourAController(FourAProperties properties, FourAClient client, FourAIdentityService identities, FourASessionService sessions,
            UserAccountRepository users, ScopeService scope, SecurityContextRepository contexts) {
        this(properties, client, identities, sessions, users, scope, contexts, Clock.systemUTC());
    }
    FourAController(FourAProperties properties, FourAClient client, FourAIdentityService identities, FourASessionService sessions,
            UserAccountRepository users, ScopeService scope, SecurityContextRepository contexts, Clock clock) {
        this.properties = properties; this.client = client; this.identities = identities; this.sessions = sessions;
        this.users = users; this.scope = scope; this.contexts = contexts;
        this.clock = clock;
    }
    @GetMapping("/options")
    public ApiResponse<?> options(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.ok(Map.of("mode", properties.mode, "localLoginEnabled", properties.localLoginEnabled(),
                "accountsMode", properties.isFourA() ? "4a" : "local", "transportMode", properties.transportMode));
    }
    @GetMapping("/4a/start")
    public void start(@RequestParam(required = false) String intent, HttpServletRequest request, HttpServletResponse response) throws IOException {
        String callback = properties.callback();
        if (intent != null) throw ApiException.invalid("账号由 4A 统一管理，无需手工绑定");
        if (!properties.isFourA()) throw ApiException.invalid("当前未启用 4A 统一登录");
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        String state = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        request.getSession(true).setAttribute(STATE_KEY, new Pending(state, clock.instant().plusSeconds(300), returnQuery(request)));
        String fallback = callback + "?state=" + state;
        privateHeaders(response);
        response.sendRedirect(properties.issuer + "/login?systemName=oneflight&fallback=" + URLEncoder.encode(fallback, StandardCharsets.UTF_8));
    }
    @GetMapping("/4a/callback")
    public void callback(@RequestParam(required = false) String state, @RequestParam(required = false) String token,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        privateHeaders(response);
        HttpSession session = request.getSession(false);
        Pending pending = null;
        if (session != null) {
            try {
                synchronized (session) {
                    Object found = session.getAttribute(STATE_KEY);
                    session.removeAttribute(STATE_KEY);
                    if (found instanceof Pending p) pending = p;
                }
            } catch (IllegalStateException ignored) { /* Expired parent session is an invalid callback. */ }
        }
        if (pending == null || state == null || state.length() > 100 || !pending.expires().isAfter(clock.instant())
                || !MessageDigest.isEqual(pending.value().getBytes(StandardCharsets.UTF_8), state.getBytes(StandardCharsets.UTF_8))) {
            redirect(response, "?authError=INVALID_STATE"); return;
        }
        String stage = "VERIFY_IDENTITY";
        try {
            var profile = client.verify(token, "oneflight");
            stage = "SYNCHRONIZE_BUSINESS_PROFILE";
            var identity = identities.synchronize(profile);
            sessions.invalidate(session);
            var account = users.findById(identity.userId).orElse(null);
            if (account == null || !account.enabled) { redirect(response, "?authError=ACCOUNT_DISABLED"); return; }
            // Discard every old account attribute and ticket association when changing identity.
            HttpSession fresh = request.getSession(true);
            stage = "ESTABLISH_PLATFORM_SESSION";
            var context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(account.username, null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + account.role.name()))));
            SecurityContextHolder.setContext(context);
            contexts.saveContext(context, request, response);
            sessions.establish(fresh, identity, token);
            redirect(response, pending.returnQuery());
        } catch (ApiException e) {
            sessions.invalidate(session);
            String code = CALLBACK_ERRORS.contains(e.getCode()) ? e.getCode() : "FOUR_A_UNAVAILABLE";
            LOG.warn("4A callback rejected: stage={}, code={}", stage, code);
            redirect(response, "?authError=" + code);
        } catch (RuntimeException e) {
            // A storage/service failure must still remove the native callback token from the URL.
            sessions.invalidate(session);
            LOG.warn("4A callback failed: stage={}, code=FOUR_A_UNAVAILABLE", stage);
            redirect(response, "?authError=FOUR_A_UNAVAILABLE");
        }
    }
    @GetMapping("/4a/identities")
    public ApiResponse<?> identities(HttpServletResponse response) {
        scope.requireRole(Role.ADMIN); response.setHeader("Cache-Control", "no-store"); return ApiResponse.ok(identities.views());
    }
    public record Binding(@NotBlank @Size(max = 36) String userId) {}
    @PutMapping("/4a/identities/{id}/binding")
    public ApiResponse<?> bind(@PathVariable String id, @Valid @RequestBody Binding binding) {
        if (properties.isFourA()) throw FourAIdentityService.managedAccounts();
        scope.requireRole(Role.ADMIN); identities.bind(id, binding.userId()); return ApiResponse.ok(null);
    }
    @DeleteMapping("/4a/identities/{id}/binding")
    public ApiResponse<?> unbind(@PathVariable String id) {
        if (properties.isFourA()) throw FourAIdentityService.managedAccounts();
        scope.requireRole(Role.ADMIN); identities.bind(id, null); return ApiResponse.ok(null);
    }
    private void redirect(HttpServletResponse response, String query) throws IOException {
        privateHeaders(response); response.sendRedirect(properties.parentOrigin + "/" + query);
    }
    private static String returnQuery(HttpServletRequest request) {
        if (!"flight".equals(request.getParameter("view"))) return "";
        StringBuilder query = new StringBuilder("?view=flight");
        for (String name : List.of("deviceId", "taskId")) {
            String value = request.getParameter(name);
            if (value == null || value.isBlank()) continue;
            if (value.length() > 180 || value.chars().anyMatch(c -> c < 32 || c == 127))
                throw ApiException.invalid("飞控入口编号无效");
            query.append('&').append(name).append('=').append(URLEncoder.encode(value, StandardCharsets.UTF_8));
        }
        return query.toString();
    }
    private static void privateHeaders(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); response.setHeader("Pragma", "no-cache");
        response.setHeader("Referrer-Policy", "no-referrer");
    }
}

package com.oneflight.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.common.*;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.Set;

/** Rechecks active platform sessions across business APIs, without involving jingqi permission. */
final class FourASessionFilter extends OncePerRequestFilter {
    private static final Set<String> PUBLIC = Set.of("/api/v1/auth/options", "/api/v1/auth/login", "/api/v1/auth/csrf",
            "/api/v1/auth/logout", "/api/v1/auth/4a/start", "/api/v1/auth/4a/callback",
            "/api/v1/flight-control/bootstrap", "/api/v1/flight-control/logout-page");
    private final FourASessionService sessions;
    private final FourAProperties properties;
    private final FourAIdentityService identities;
    private final com.oneflight.repository.UserAccountRepository users;
    private final ObjectMapper json = new ObjectMapper();
    FourASessionFilter(FourASessionService sessions, FourAProperties properties, FourAIdentityService identities,
            com.oneflight.repository.UserAccountRepository users) {
        this.sessions = sessions; this.properties = properties; this.identities = identities; this.users = users;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !properties.isFourA() || !request.getRequestURI().startsWith("/api/v1/") || PUBLIC.contains(request.getRequestURI());
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getName()) && !sessions.isMaintenance(request.getSession(false))) {
            try {
                var identity = sessions.requirePlatformIdentity(request);
                String path = request.getRequestURI();
                if (!path.startsWith("/api/v1/auth/") && !path.startsWith("/api/v1/flight-control/")) {
                    var user = users.findById(identity.localUserId()).orElseThrow(FourAClient::expired);
                    if (!identities.currentView(user).businessAccessAssigned()) {
                        throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,
                                "PLATFORM_ACCESS_PENDING", "4A 登录已完成，请联系平台管理员配置业务权限");
                    }
                }
            }
            catch (ApiException e) {
                response.setStatus(e.getStatus().value()); response.setContentType("application/json;charset=UTF-8");
                response.setHeader("Cache-Control", "no-store"); json.writeValue(response.getWriter(), ApiResponse.error(e.getCode(), e.getMessage())); return;
            }
        }
        chain.doFilter(request, response);
    }
}

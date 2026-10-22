package com.oneflight.web;

import com.oneflight.auth.*;
import com.oneflight.common.*;

import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import org.springframework.security.authentication.*;
import org.springframework.security.core.context.*;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthenticationManager manager;
    private final SecurityContextRepository contexts;
    private final ScopeService scope;
    private final FourAProperties fourA;
    private final FourASessionService sessions;

    public AuthController(
            AuthenticationManager manager, SecurityContextRepository contexts, ScopeService scope,
            FourAProperties fourA, FourASessionService sessions) {
        this.manager = manager;
        this.contexts = contexts;
        this.scope = scope;
        this.fourA = fourA;
        this.sessions = sessions;
    }

    public record Login(
            @NotBlank @Size(max = 80) String username,
            @NotBlank @Size(max = 128) String password) {}

    @GetMapping("/csrf")
    public ApiResponse<?> csrf(CsrfToken token, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.ok(
                Map.of("token", token.getToken(), "headerName", token.getHeaderName()));
    }

    @PostMapping("/login")
    public ApiResponse<?> login(
            @Valid @RequestBody Login login,
            HttpServletRequest request,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        if (!fourA.localLoginEnabled()) throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,
                "LOCAL_LOGIN_DISABLED", "本地维护登录未启用，请使用 4A 登录");
        var auth =
                manager.authenticate(
                        UsernamePasswordAuthenticationToken.unauthenticated(
                                login.username(), login.password()));
        sessions.invalidate(request.getSession(false));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        request.getSession(true).setAttribute(FourASessionService.LOCAL_MAINTENANCE, true);
        return ApiResponse.ok(scope.currentUser());
    }

    @GetMapping("/me")
    public ApiResponse<?> me(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.ok(scope.currentUser());
    }

    @PostMapping("/logout")
    public ApiResponse<?> logout(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        boolean success = sessions.logout(request.getSession(false));
        return ApiResponse.ok(Map.of("externalLogoutSucceeded", success, "message", success ? "已退出登录" : "本地已退出，但 4A 注销失败；再次进入将重新验证登录态"));
    }
}

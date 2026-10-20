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

    public AuthController(
            AuthenticationManager manager, SecurityContextRepository contexts, ScopeService scope) {
        this.manager = manager;
        this.contexts = contexts;
        this.scope = scope;
    }

    public record Login(
            @NotBlank @Size(max = 80) String username,
            @NotBlank @Size(max = 128) String password) {}

    @GetMapping("/csrf")
    public ApiResponse<?> csrf(CsrfToken token) {
        return ApiResponse.ok(
                Map.of("token", token.getToken(), "headerName", token.getHeaderName()));
    }

    @PostMapping("/login")
    public ApiResponse<?> login(
            @Valid @RequestBody Login login,
            HttpServletRequest request,
            HttpServletResponse response) {
        var auth =
                manager.authenticate(
                        UsernamePasswordAuthenticationToken.unauthenticated(
                                login.username(), login.password()));
        if (request.getSession(false) != null) request.changeSessionId();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        return ApiResponse.ok(scope.currentUser());
    }

    @GetMapping("/me")
    public ApiResponse<?> me() {
        return ApiResponse.ok(scope.currentUser());
    }

    @PostMapping("/logout")
    public ApiResponse<?> logout(HttpServletRequest request) {
        var s = request.getSession(false);
        if (s != null) s.invalidate();
        SecurityContextHolder.clearContext();
        return ApiResponse.ok(null);
    }
}

package com.oneflight.auth;

import com.oneflight.repository.UserAccountRepository;

import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.*;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.*;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.web.cors.*;

import java.util.*;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    UserDetailsService userDetailsService(UserAccountRepository users) {
        return username -> {
            var u =
                    users.findByUsername(username)
                            .orElseThrow(() -> new UsernameNotFoundException("账号不存在"));
            return User.withUsername(u.username)
                    .password(u.passwordHash)
                    .authorities("ROLE_" + u.role.name())
                    .disabled(!u.enabled)
                    .build();
        };
    }

    @Bean
    AuthenticationManager authenticationManager(
            UserDetailsService userDetails, PasswordEncoder encoder) {
        var provider = new DaoAuthenticationProvider(userDetails);
        provider.setPasswordEncoder(encoder);
        return new ProviderManager(provider);
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    @Order(1)
    SecurityFilterChain childBootstrapChain(HttpSecurity http) throws Exception {
        // Child pages and internal gateway checks authenticate with tickets/grants + gateway secret.
        // inside their controller. Child-origin browsers cannot supply the parent JSESSIONID.
        return http.securityMatcher("/api/v1/flight-control/bootstrap", "/api/v1/flight-control/logout-page", "/api/v1/flight-control/gateway-check")
                .csrf(c -> c.disable()).sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .headers(h -> h.frameOptions(f -> f.disable()).referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)))
                .authorizeHttpRequests(a -> a.requestMatchers(HttpMethod.GET, "/api/v1/flight-control/bootstrap", "/api/v1/flight-control/logout-page", "/api/v1/flight-control/gateway-check").permitAll().anyRequest().denyAll())
                .build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain filterChain(HttpSecurity http, SecurityContextRepository repository,
            FourASessionService sessions, FourAProperties fourA, FourAIdentityService identities, UserAccountRepository users)
            throws Exception {
        var csrf = new HttpSessionCsrfTokenRepository();
        csrf.setHeaderName("X-CSRF-TOKEN");
        return http.cors(Customizer.withDefaults())
                .csrf(c -> c.csrfTokenRepository(csrf))
                .headers(h -> h.referrerPolicy(r -> r.policy(
                        ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)))
                .securityContext(c -> c.securityContextRepository(repository))
                .addFilterBefore(new FourASessionFilter(sessions, fourA, identities, users), AuthorizationFilter.class)
                .authorizeHttpRequests(
                        a ->
                                a.requestMatchers(HttpMethod.GET,
                                                "/", "/index.html", "/logo.svg", "/assets/**", "/healthz")
                                        .permitAll()
                                        .requestMatchers(HttpMethod.HEAD,
                                                "/", "/index.html", "/logo.svg", "/assets/**", "/healthz")
                                        .permitAll()
                                        .requestMatchers(
                                                "/actuator/health",
                                                "/api/v1/auth/csrf",
                                                "/api/v1/auth/login",
                                                "/api/v1/auth/options",
                                                "/api/v1/auth/4a/start",
                                                "/api/v1/auth/4a/callback",
                                                "/v3/api-docs/**",
                                                "/swagger-ui/**",
                                                "/swagger-ui.html")
                                        .permitAll()
                                        .anyRequest()
                                        .authenticated())
                .exceptionHandling(
                        e ->
                                e.authenticationEntryPoint(
                                                (q, s, x) -> {
                                                    s.setStatus(401);
                                                    s.setContentType(
                                                            "application/json;charset=UTF-8");
                                                    s.getWriter()
                                                            .write(
                                                                    "{\"code\":\"UNAUTHENTICATED\",\"message\":\"请先登录\",\"data\":null}");
                                                })
                                        .accessDeniedHandler(
                                                (q, s, x) -> {
                                                    s.setStatus(403);
                                                    s.setContentType(
                                                            "application/json;charset=UTF-8");
                                                    s.getWriter()
                                                            .write(
                                                                    "{\"code\":\"FORBIDDEN\",\"message\":\"权限不足或安全令牌已失效\",\"data\":null}");
                                                }))
                .logout(l -> l.disable())
                .build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @org.springframework.beans.factory.annotation.Value(
                            "${oneflight.allowed-origins:http://localhost:5173}")
                    String origins) {
        var config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.asList(origins.split(",")));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Content-Type", "X-CSRF-TOKEN"));
        config.setAllowCredentials(true);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }
}

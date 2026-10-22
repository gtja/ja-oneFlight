package com.oneflight.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.oneflight.common.ApiException;
import com.oneflight.domain.UserAccount;
import com.oneflight.domain.ExternalIdentity;
import com.oneflight.repository.ExternalIdentityRepository;
import com.oneflight.repository.UserAccountRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

class FourASessionServiceTest {
    @AfterEach void cleanup() { SecurityContextHolder.clearContext(); }

    @Test void localAndExplicitMaintenanceLoginsKeepTheirSessionsWhenFlightRequiresSso() {
        for (String mode : List.of("local", "4a")) {
            var users = mock(UserAccountRepository.class);
            var client = mock(FourAClient.class);
            var user = new UserAccount(); user.username = "local-pilot"; user.enabled = true;
            when(users.findByUsername(user.username)).thenReturn(Optional.of(user));
            var session = session(user.username);
            // Local mode also accepts valid sessions established before the maintenance marker existed.
            if ("4a".equals(mode)) session.setAttribute(FourASessionService.LOCAL_MAINTENANCE, true);
            var service = new FourASessionService(client, new FourAProperties(mode, true,
                    "https://identity.example.test", "https://platform.example.test", 8),
                    mock(ExternalIdentityRepository.class), users);

            assertThatThrownBy(() -> service.requireFlightIdentity(session)).isInstanceOfSatisfying(ApiException.class, error -> {
                assertThat(error.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                assertThat(error.getCode()).isEqualTo("FOUR_A_LOGIN_REQUIRED");
            });
            assertThat(session.isInvalid()).isFalse();
            verifyNoInteractions(client);
        }
    }

    @Test void disabledOrMissingLocalAccountIsRejectedAndItsSessionInvalidated() {
        var users = mock(UserAccountRepository.class);
        var client = mock(FourAClient.class);
        var user = new UserAccount(); user.username = "disabled"; user.enabled = false;
        when(users.findByUsername(user.username)).thenReturn(Optional.of(user));
        var service = new FourASessionService(client, new FourAProperties("local", false,
                "https://identity.example.test", "https://platform.example.test", 8),
                mock(ExternalIdentityRepository.class), users);
        for (String username : List.of("disabled", "missing")) {
            var session = session(username);
            assertThatThrownBy(() -> service.requireFlightIdentity(session)).isInstanceOfSatisfying(ApiException.class,
                    error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED));
            assertThat(session.isInvalid()).isTrue();
        }
        verifyNoInteractions(client);
    }

    @Test void successfulRemoteReverificationCannotRestoreAConcurrentLocalDisableOrLogout() {
        for (boolean logoutDuringVerification : List.of(false, true)) {
            var users = mock(UserAccountRepository.class);
            var identities = mock(ExternalIdentityRepository.class);
            var client = mock(FourAClient.class);
            var user = new UserAccount(); user.username = "stable-internal-principal";
            var identity = new ExternalIdentity();
            identity.issuer = "https://identity.example.test";
            identity.externalUserId = "immutable-4a-user"; identity.userId = user.id;
            when(identities.findById(identity.id)).thenReturn(Optional.of(identity));
            when(users.findById(user.id)).thenAnswer(call -> Optional.of(user));
            var service = new FourASessionService(client, new FourAProperties("4a", false,
                    identity.issuer, "https://platform.example.test", 8), identities, users);
            var session = session(user.username);
            service.establish(session, identity, "personal-token");
            org.springframework.test.util.ReflectionTestUtils.setField(
                    session.getAttribute(FourASessionService.ATTRIBUTE), "verifiedAt", 0L);
            when(client.verify("personal-token", "oneflight")).thenAnswer(call -> {
                if (logoutDuringVerification) session.invalidate();
                else user.enabled = false;
                return new FourAClient.Profile(identity.externalUserId, "external-name", "显示名");
            });

            assertThatThrownBy(() -> service.requirePlatformIdentity(session)).isInstanceOfSatisfying(ApiException.class,
                    error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED));
            assertThat(session.isInvalid()).isTrue();
            verify(client).verify("personal-token", "oneflight");
        }
    }

    private MockHttpSession session(String username) {
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(username, null,
                List.of(new SimpleGrantedAuthority("ROLE_PILOT"))));
        var session = new MockHttpSession();
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        return session;
    }
}

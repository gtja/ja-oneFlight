package com.oneflight;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.FourAIdentityService;
import com.oneflight.common.ApiException;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.repository.UserAccountRepository;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

class ScopeRequestCacheTest {
    @AfterEach void clearContext() {
        RequestContextHolder.resetRequestAttributes();
        SecurityContextHolder.clearContext();
    }

    @Test void readsAccountOncePerRequestAndRechecksDisabledAccountOnNextRequest() {
        UserAccountRepository users = mock(UserAccountRepository.class);
        UserAccount account = new UserAccount();
        account.username = "operator"; account.role = Role.ADMIN; account.organizationId = "org";
        when(users.findByUsername("operator")).thenReturn(Optional.of(account));
        ScopeService scope = new ScopeService(users, mock(ResourceRepository.class), mock(TaskRepository.class));
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated("operator", null, java.util.List.of()));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        for (int index = 0; index < 1500; index++) assertThat(scope.canAccess("org", "区域")).isTrue();
        verify(users, times(1)).findByUsername("operator");
        account.enabled = false;
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        assertThatThrownBy(scope::currentUser).isInstanceOf(ApiException.class);
        verify(users, times(2)).findByUsername("operator");
    }

    @Test void doesNotCarryScopeAcrossAuthenticationChangesWithinOneRequest() {
        UserAccountRepository users = mock(UserAccountRepository.class);
        UserAccount admin = new UserAccount(); admin.username = "admin"; admin.role = Role.ADMIN;
        UserAccount pilot = new UserAccount(); pilot.username = "pilot"; pilot.role = Role.PILOT;
        when(users.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(users.findByUsername("pilot")).thenReturn(Optional.of(pilot));
        ScopeService scope = new ScopeService(users, mock(ResourceRepository.class), mock(TaskRepository.class));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated("admin", null, java.util.List.of()));
        assertThat(scope.currentUser().role()).isEqualTo(Role.ADMIN);
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated("pilot", null, java.util.List.of()));
        assertThat(scope.currentUser().role()).isEqualTo(Role.PILOT);
    }

    @Test void externalDisplayUsernameDoesNotBreakInternalPrincipalRequestCache() {
        UserAccountRepository users = mock(UserAccountRepository.class);
        FourAIdentityService identities = mock(FourAIdentityService.class);
        UserAccount account = new UserAccount();
        account.username = "4a_stable-principal";
        account.role = Role.ADMIN;
        when(users.findByUsername(account.username)).thenReturn(Optional.of(account));
        when(identities.currentView(account)).thenReturn(new CurrentUser(account.id,
                "actual-4a-username", "4A人员", Role.ADMIN, "org",
                java.util.Set.of(), java.util.Set.of(), java.util.Set.of(), true));
        ScopeService scope = new ScopeService(users, mock(ResourceRepository.class),
                mock(TaskRepository.class), identities);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(account.username, null, java.util.List.of()));
        for (int index = 0; index < 100; index++) {
            assertThat(scope.currentUser().username()).isEqualTo("actual-4a-username");
            assertThat(scope.canAccess("org", null)).isTrue();
        }
        verify(users, times(1)).findByUsername(account.username);
        verify(identities, times(1)).currentView(account);
    }

    @Test void pendingExternalIdentityCannotUseLocalRoleOrOrganizationGrants() {
        UserAccountRepository users = mock(UserAccountRepository.class);
        FourAIdentityService identities = mock(FourAIdentityService.class);
        UserAccount account = new UserAccount(); account.username = "pending";
        when(users.findByUsername(account.username)).thenReturn(Optional.of(account));
        when(identities.currentView(account)).thenReturn(new CurrentUser(account.id,
                "verified-4a-person", "已验证人员", Role.ADMIN, "org",
                java.util.Set.of(), java.util.Set.of(), java.util.Set.of(), false));
        ScopeService scope = new ScopeService(users, mock(ResourceRepository.class),
                mock(TaskRepository.class), identities);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(account.username, null, java.util.List.of()));
        assertThat(scope.currentUser().businessAccessAssigned()).isFalse();
        assertThat(scope.canAccess("org", null)).isFalse();
        assertThatThrownBy(() -> scope.requireRole(Role.ADMIN))
                .isInstanceOf(ApiException.class).hasMessageContaining("平台管理员");
    }
}

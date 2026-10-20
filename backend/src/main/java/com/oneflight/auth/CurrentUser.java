package com.oneflight.auth;

import java.util.Set;

public record CurrentUser(
        String id,
        String username,
        String displayName,
        Role role,
        String organizationId,
        Set<String> regions,
        Set<String> deviceIds,
        Set<String> organizationIds) {
    public CurrentUser(
            String id,
            String username,
            String displayName,
            Role role,
            String organizationId,
            Set<String> regions,
            Set<String> deviceIds) {
        this(id, username, displayName, role, organizationId, regions, deviceIds, Set.of());
    }
}

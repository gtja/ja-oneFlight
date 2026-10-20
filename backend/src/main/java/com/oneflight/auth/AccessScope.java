package com.oneflight.auth;

import java.util.Set;

public interface AccessScope {
    CurrentUser currentUser();

    Set<String> allowedDeviceIds();

    boolean canAccess(String organizationId, String region);

    void requireDevice(String sourceDeviceId);
}

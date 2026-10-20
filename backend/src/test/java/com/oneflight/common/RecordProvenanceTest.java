package com.oneflight.common;

import static org.assertj.core.api.Assertions.*;

import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class RecordProvenanceTest {
    private CurrentUser user(Role role) {
        return new CurrentUser("operator", "operator", "岗位", role, "org", Set.of(), Set.of(), Set.of());
    }

    @Test void stampsActualOperatorAndPreservesOrigin() {
        String value = RecordProvenance.apply(null, Map.of("origin", "BUSINESS_INITIALIZATION", "key", "a"), user(Role.ADMIN));
        assertThat(RecordProvenance.view(value)).containsEntry("recordedBy", "operator").containsKey("recordedAt");
        assertThat(RecordProvenance.apply(value, Map.of("origin", "BUSINESS_INITIALIZATION"), user(Role.DEPARTMENT))).isEqualTo(value);
        assertThatThrownBy(() -> RecordProvenance.apply(value, Map.of("origin", "MANUAL"), user(Role.ADMIN))).isInstanceOf(ApiException.class);
    }

    @Test void rejectsForgedSourceAndUnauthorizedInitialization() {
        assertThatThrownBy(() -> RecordProvenance.apply(null, Map.of("origin", "SOURCE_IMPORT"), user(Role.ADMIN))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> RecordProvenance.apply(null, Map.of("origin", "BUSINESS_INITIALIZATION"), user(Role.PILOT))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> RecordProvenance.apply(null, Map.of("origin", "MANUAL", "recordedBy", "someone"), user(Role.ADMIN))).isInstanceOf(ApiException.class);
    }
}

package com.oneflight.common;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;

class DeploymentOriginsTest {
    @Test void httpRequiresExplicitModeAndCanonicalIpv4Literal() {
        assertThat(DeploymentOrigins.publicOrigin("http://127.0.0.1:8088/", "http-ip"))
                .isEqualTo("http://127.0.0.1:8088");
        assertThatThrownBy(() -> DeploymentOrigins.publicOrigin("http://127.0.0.1:8088", "https"))
                .isInstanceOf(IllegalArgumentException.class);
        for (String host : new String[] {"localhost", "flight.example", "127.1", "2130706433", "0x7f000001",
                "127.000.0.1", "256.0.0.1", "[::1]"}) {
            assertThatThrownBy(() -> DeploymentOrigins.publicOrigin("http://" + host + ":8088", "http-ip"))
                    .as(host).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void originRejectsCredentialsPathsFragmentsQueriesAndInvalidPorts() {
        for (String origin : new String[] {"http://user@192.0.2.10:8088", "http://192.0.2.10:8088/path",
                "http://192.0.2.10:8088//", "http://192.0.2.10:8088?next=x", "http://192.0.2.10:8088#x",
                "http://192.0.2.10:0", "http://192.0.2.10:65536", "http://192.0.2.10:",
                " http://192.0.2.10:8088", "http://192.0.2.10:8088/ "}) {
            assertThatThrownBy(() -> DeploymentOrigins.publicOrigin(origin, "http-ip"))
                    .as(origin).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void browserOriginNormalizationRemovesDefaultPortsAndOneRootSlash() {
        assertThat(DeploymentOrigins.publicOrigin("HTTPS://FLIGHT.EXAMPLE:443/", "https"))
                .isEqualTo("https://flight.example");
        assertThat(DeploymentOrigins.publicOrigin("http://192.0.2.10:80/", "http-ip"))
                .isEqualTo("http://192.0.2.10");
        assertThat(DeploymentOrigins.publicOrigin("http://192.0.2.10", "http-ip"))
                .isEqualTo("http://192.0.2.10");
    }

    @Test void identityTransportNeverFallsBackToHttp() {
        assertThat(DeploymentOrigins.identityOrigin("HTTPS://IDENTITY.EXAMPLE:443/"))
                .isEqualTo("https://identity.example");
        assertThatThrownBy(() -> DeploymentOrigins.identityOrigin("http://192.0.2.10:32712"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void invalidTransportModeFailsEvenWithoutIntegrationConfiguration() {
        assertThatThrownBy(() -> DeploymentOrigins.publicOrigin("", "http"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

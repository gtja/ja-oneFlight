package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;

class FlightControlPropertiesTest {
    private static final String SECRET = "abcdefghijklmnopqrstuvwxyz123456";

    @Test void legacyModeRequiresNoIntegrationConfiguration() {
        assertThat(new FlightControlProperties("local", "", "", "").embedded()).isFalse();
    }

    @Test void embeddedModeRejectsSameOriginInsecureUrlsAndUrlComponents() {
        for (String origin : new String[] {"http://flight.example", "https://parent.example", "https://parent.example:444", "https://flight.example/path",
                "https://user@flight.example", "https://flight.example?next=bad", "https://flight.example#fragment"}) {
            assertThatThrownBy(() -> new FlightControlProperties("embedded", origin, "https://parent.example", SECRET))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(() -> new FlightControlProperties("embedded", "https://flight.example", "https://parent.example", "short"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void httpIpModeRequiresExplicitOptInAndTwoPortsOnTheSameIpv4() {
        var properties = new FlightControlProperties("embedded", "http://192.0.2.10:8089/",
                "http://192.0.2.10:8088/", SECRET, "http-ip");
        assertThat(properties.origin()).isEqualTo("http://192.0.2.10:8089");
        assertThat(properties.parentOrigin()).isEqualTo("http://192.0.2.10:8088");
        assertThat(properties.transportMode()).isEqualTo("http-ip");
        assertThat(properties.microphoneAvailable()).isFalse();
        assertThatThrownBy(() -> new FlightControlProperties("embedded", "http://192.0.2.10:8089",
                "http://192.0.2.10:8088", SECRET)).isInstanceOf(IllegalArgumentException.class);
        for (String child : new String[] {"http://192.0.2.10:8088", "http://192.0.2.11:8089",
                "http://flight.example:8089", "http://localhost:8089", "https://192.0.2.10:8089"}) {
            assertThatThrownBy(() -> new FlightControlProperties("embedded", child,
                    "http://192.0.2.10:8088", SECRET, "http-ip")).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void defaultHttpPortIsNormalizedAndStillParticipatesInIsolationCheck() {
        var properties = new FlightControlProperties("embedded", "http://192.0.2.10:8089",
                "http://192.0.2.10:80/", SECRET, "http-ip");
        assertThat(properties.parentOrigin()).isEqualTo("http://192.0.2.10");
        assertThatThrownBy(() -> new FlightControlProperties("embedded", "http://192.0.2.10:80",
                "http://192.0.2.10", SECRET, "http-ip")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void httpsModeKeepsSeparateHostsAndNormalizesBrowserOrigins() {
        var properties = new FlightControlProperties("embedded", "HTTPS://FLIGHT.EXAMPLE:443/",
                "https://PARENT.EXAMPLE:443/", SECRET);
        assertThat(properties.origin()).isEqualTo("https://flight.example");
        assertThat(properties.parentOrigin()).isEqualTo("https://parent.example");
        assertThat(properties.microphoneAvailable()).isTrue();
    }

    @Test void directModeUsesTheRemoteHttpsSiteWithoutGatewayOrTwoLocalPorts() {
        var properties = new FlightControlProperties("direct", "http://127.0.0.1:8089",
                "http://127.0.0.1:8088", "", "http-ip");
        assertThat(properties.mode()).isEqualTo("direct");
        assertThat(properties.embedded()).isFalse();
        assertThat(properties.direct()).isTrue();
        assertThat(properties.directUrl()).isEqualTo("https://dushu.jing-an.com:32716/control-room");
        assertThat(properties.origin()).isEqualTo("https://dushu.jing-an.com:32716");
    }

    @Test void directModeUsesAnExplicitFixedUrlOrTheConfiguredSourceOrigin() {
        var explicit = new FlightControlProperties("direct", "", "", "", "https",
                "HTTPS://FLIGHT.EXAMPLE:443/control-room", "https://unused.example");
        assertThat(explicit.directUrl()).isEqualTo("https://flight.example/control-room");
        var fallback = new FlightControlProperties("direct", "", "", "", "https", "", "https://source.example:32716/");
        assertThat(fallback.directUrl()).isEqualTo("https://source.example:32716/control-room");
    }

    @Test void directModeRejectsTokenQueriesCredentialsFragmentsAndNonHttpsAddresses() {
        for (String url : new String[]{"http://118.31.104.96:32716/control-room", "javascript:alert(1)",
                "https://user:password@flight.example/control-room", "https://flight.example/control-room?token=secret",
                "https://flight.example/control-room#token", "https://flight.example:0/control-room"}) {
            assertThatThrownBy(() -> new FlightControlProperties("direct", "", "", "", "https", url, "https://source.example"))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void embeddedDefaultEntryAcceptsOnlyAStationLocalAbsolutePath() {
        var properties = new FlightControlProperties("embedded", "https://flight.example", "https://parent.example",
                SECRET, "https", "", "https://source.example", "/source/UAV_AIRPORT");
        assertThat(properties.entryPath()).isEqualTo("/source/UAV_AIRPORT");
        assertThat(new FlightControlProperties("local", "", "", "").entryPath()).isEqualTo("/control-room");
        for (String path : new String[]{"//untrusted.example/path", "https://untrusted.example/path", "relative",
                "/source?token=secret", "/source#fragment", "/source/../other"}) {
            assertThatThrownBy(() -> new FlightControlProperties("local", "", "", "", "https", "", "https://source.example", path))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }
}

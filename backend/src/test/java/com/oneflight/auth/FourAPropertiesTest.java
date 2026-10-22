package com.oneflight.auth;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;

class FourAPropertiesTest {
    @Test void fixedIpCallbackUsesExplicitCompatibilityModeWhileIssuerRemainsHttps() {
        var properties = new FourAProperties("4a", false, "HTTPS://IDENTITY.EXAMPLE:443/",
                "http://192.0.2.10:8088/", 8, "http-ip");
        assertThat(properties.callback()).isEqualTo("http://192.0.2.10:8088/api/v1/auth/4a/callback");
        assertThat(properties.issuer).isEqualTo("https://identity.example");
        assertThat(properties.localLoginEnabled()).isFalse();
        assertThatThrownBy(() -> new FourAProperties("4a", false, "http://192.0.2.10:32712",
                "http://192.0.2.10:8088", 8, "http-ip")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void defaultModeNeverAcceptsHttpCallbackAndCompatibilityRejectsDnsCallback() {
        assertThatThrownBy(() -> new FourAProperties("4a", false, "https://identity.example",
                "http://192.0.2.10:8088", 8)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FourAProperties("4a", false, "https://identity.example",
                "http://platform.example:8088", 8, "http-ip")).isInstanceOf(IllegalArgumentException.class);
    }
}

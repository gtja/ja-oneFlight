package com.oneflight.integration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Provider credentials are backend configuration and never part of public source status. */
@ConfigurationProperties("oneflight.sources")
public record SourceProperties(String gatewayOrigin, String gatewaySystem, String targetHost,
        String token, String username, String dushuJdbcUrl, String dushuUsername, String dushuPassword,
        String icosJdbcUrl, String icosUsername, String icosPassword, String mqttUrl,
        String mqttUsername, String mqttPassword, String algorithmOrigin, Integer timeoutSeconds) {
    public SourceProperties {
        gatewayOrigin = defaultValue(gatewayOrigin, "https://dushu.jing-an.com:32716");
        gatewaySystem = defaultValue(gatewaySystem, "jingqi");
        targetHost = defaultValue(targetHost, "47.96.225.165:32716");
        algorithmOrigin = defaultValue(algorithmOrigin, "http://47.111.155.82:32052");
        timeoutSeconds = timeoutSeconds == null ? 8 : Math.clamp(timeoutSeconds, 1, 30);
    }
    @Override public String toString() {
        return "SourceProperties[gatewayConfigured=" + gatewayConfigured() + ", dushuConfigured="
                + dushuConfigured() + ", icosConfigured=" + icosConfigured() + ", mqttConfigured=" + mqttConfigured() + "]";
    }
    private static String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
    public boolean gatewayConfigured() { return token != null && !token.isBlank(); }
    public boolean dushuConfigured() { return configured(dushuJdbcUrl, dushuUsername, dushuPassword); }
    public boolean icosConfigured() { return configured(icosJdbcUrl, icosUsername, icosPassword); }
    public boolean mqttConfigured() { return configured(mqttUrl, mqttUsername, mqttPassword); }
    private boolean configured(String first, String second, String third) {
        return first != null && !first.isBlank() && second != null && !second.isBlank()
                && third != null && !third.isBlank();
    }
}

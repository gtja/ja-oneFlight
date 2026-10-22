package com.oneflight.flightcontrol;

import com.oneflight.common.DeploymentOrigins;
import java.net.URI;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Deployment-owned, fixed origins. They are never derived from browser input or Host headers. */
@Component
public class FlightControlProperties {
    private final boolean embedded;
    private final String mode;
    private final String directUrl;
    private final String entryPath;
    private final String origin;
    private final String parentOrigin;
    private final String gatewaySecret;
    private final String transportMode;

    @Autowired public FlightControlProperties(
            @Value("${FLIGHT_CONTROL_MODE:local}") String mode,
            @Value("${FLIGHT_CONTROL_ORIGIN:}") String origin,
            @Value("${ONEFLIGHT_PUBLIC_ORIGIN:}") String parentOrigin,
            @Value("${FLIGHT_CONTROL_GATEWAY_SECRET:}") String gatewaySecret,
            @Value("${oneflight.transport-mode:https}") String transportMode,
            @Value("${FLIGHT_CONTROL_DIRECT_URL:}") String directUrl,
            @Value("${oneflight.sources.gateway-origin:https://dushu.jing-an.com:32716}") String sourceOrigin,
            @Value("${FLIGHT_CONTROL_ENTRY_PATH:/control-room}") String entryPath) {
        if (!"local".equals(mode) && !"embedded".equals(mode) && !"direct".equals(mode)) {
            throw new IllegalArgumentException("FLIGHT_CONTROL_MODE must be local, embedded or direct");
        }
        this.mode = mode;
        this.embedded = "embedded".equals(mode);
        this.transportMode = DeploymentOrigins.transportMode(transportMode);
        this.entryPath = entryPath(entryPath);
        this.directUrl = direct() ? directUrl(directUrl == null || directUrl.isBlank()
                ? sourceOrigin.replaceAll("/+$", "") + "/control-room" : directUrl) : "";
        this.origin = direct() ? directOrigin(URI.create(this.directUrl)) : DeploymentOrigins.publicOrigin(origin, this.transportMode);
        this.parentOrigin = DeploymentOrigins.publicOrigin(parentOrigin, this.transportMode);
        this.gatewaySecret = gatewaySecret == null ? "" : gatewaySecret;
        if (embedded) {
            if (this.origin.isEmpty() || this.parentOrigin.isEmpty() || this.gatewaySecret.length() < 32) {
                throw new IllegalArgumentException("嵌入模式需要固定的平台、飞控地址及至少 32 字符的网关密钥");
            }
            DeploymentOrigins.requireSeparateFlightOrigin(this.origin, this.parentOrigin, this.transportMode);
        }
    }

    public FlightControlProperties(String mode, String origin, String parentOrigin, String gatewaySecret,
            String transportMode, String directUrl, String sourceOrigin) {
        this(mode, origin, parentOrigin, gatewaySecret, transportMode, directUrl, sourceOrigin, "/control-room");
    }

    public FlightControlProperties(String mode, String origin, String parentOrigin, String gatewaySecret, String transportMode) {
        this(mode, origin, parentOrigin, gatewaySecret, transportMode, "", "https://dushu.jing-an.com:32716");
    }

    public FlightControlProperties(String mode, String origin, String parentOrigin, String gatewaySecret) {
        this(mode, origin, parentOrigin, gatewaySecret, DeploymentOrigins.HTTPS);
    }

    public boolean embedded() { return embedded; }
    public boolean direct() { return "direct".equals(mode); }
    public String mode() { return mode; }
    public String directUrl() { return directUrl; }
    public String entryPath() { return entryPath; }
    public String origin() { return origin; }
    public String parentOrigin() { return parentOrigin; }
    public String transportMode() { return transportMode; }
    public boolean microphoneAvailable() { return !DeploymentOrigins.HTTP_IP.equals(transportMode); }
    String gatewaySecret() { return gatewaySecret; }

    static String entryPath(String value) {
        try {
            URI uri = URI.create(value);
            if (!value.startsWith("/") || value.startsWith("//") || uri.isAbsolute()
                    || uri.getRawAuthority() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || !value.equals(uri.normalize().toString())) throw new IllegalArgumentException();
            return value;
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new IllegalArgumentException("飞控默认入口须为不含地址、查询参数或片段的站内绝对路径");
        }
    }

    private static String directUrl(String value) {
        try {
            URI uri = URI.create(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getPort() == 0 || uri.getPort() > 65535 || uri.getPort() < -1
                    || uri.getRawAuthority().endsWith(":")) throw new IllegalArgumentException();
            String path = uri.getRawPath();
            return directOrigin(uri) + (path == null || path.isEmpty() ? "/" : path);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new IllegalArgumentException("飞控直连地址须为不含账号、查询参数或片段的固定 HTTPS URL");
        }
    }
    private static String directOrigin(URI uri) {
        int port = uri.getPort();
        return "https://" + uri.getHost().toLowerCase(Locale.ROOT) + (port == -1 || port == 443 ? "" : ":" + port);
    }

}

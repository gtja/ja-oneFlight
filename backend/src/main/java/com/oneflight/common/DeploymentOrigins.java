package com.oneflight.common;

import java.net.URI;
import java.util.Locale;

/** Fixed public origins shared by authentication and the flight-control gateway. */
public final class DeploymentOrigins {
    public static final String HTTPS = "https";
    public static final String HTTP_IP = "http-ip";

    private DeploymentOrigins() { }

    public static String transportMode(String value) {
        if (!HTTPS.equals(value) && !HTTP_IP.equals(value)) {
            throw new IllegalArgumentException("ONEFLIGHT_TRANSPORT_MODE 必须是 https 或 http-ip");
        }
        return value;
    }

    public static String publicOrigin(String value, String transportMode) {
        transportMode(transportMode);
        if (value == null || value.isEmpty()) return "";
        URI uri = originUri(value);
        if (HTTP_IP.equals(transportMode)) {
            if (!"http".equalsIgnoreCase(uri.getScheme()) || !ipv4(uri.getHost())) {
                throw new IllegalArgumentException("HTTP IP 兼容模式需要固定的 http://IPv4 地址和有效端口");
            }
        } else if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("平台和飞控地址必须使用 HTTPS；HTTP IP 部署需显式启用 http-ip 模式");
        }
        return normalized(uri);
    }

    /** Identity-provider transport is always HTTPS, including IP compatibility deployments. */
    public static String identityOrigin(String value) {
        URI uri = originUri(value);
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("4A 服务必须使用 HTTPS");
        }
        return normalized(uri);
    }

    public static void requireSeparateFlightOrigin(String child, String parent, String transportMode) {
        URI childUri = URI.create(child);
        URI parentUri = URI.create(parent);
        if (HTTP_IP.equals(transportMode)) {
            if (!childUri.getHost().equals(parentUri.getHost()) || effectivePort(childUri) == effectivePort(parentUri)) {
                throw new IllegalArgumentException("HTTP IP 嵌入模式需要同一 IPv4 地址的两个不同端口");
            }
        } else if (childUri.getHost().equals(parentUri.getHost())) {
            throw new IllegalArgumentException("HTTPS 嵌入模式需要独立的平台和飞控域名");
        }
    }

    private static URI originUri(String value) {
        try {
            URI uri = URI.create(value);
            String path = uri.getRawPath();
            if (uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                    || uri.getRawFragment() != null || (!"".equals(path) && !"/".equals(path))
                    || uri.getPort() == 0 || uri.getPort() > 65535 || uri.getPort() < -1
                    || uri.getRawAuthority().endsWith(":")) {
                throw new IllegalArgumentException();
            }
            return uri;
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new IllegalArgumentException("部署地址必须是无路径、参数和账号信息的有效 Origin");
        }
    }

    private static boolean ipv4(String host) {
        if (host == null) return false;
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String part : parts) {
            if (!part.matches("0|[1-9][0-9]{0,2}") || Integer.parseInt(part) > 255) return false;
        }
        return true;
    }

    private static String normalized(URI uri) {
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        int port = uri.getPort();
        boolean defaultPort = port == -1 || ("https".equals(scheme) && port == 443)
                || ("http".equals(scheme) && port == 80);
        return scheme + "://" + host + (defaultPort ? "" : ":" + port);
    }

    private static int effectivePort(URI uri) {
        return uri.getPort() == -1 ? ("https".equals(uri.getScheme()) ? 443 : 80) : uri.getPort();
    }
}

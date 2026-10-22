package com.oneflight.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/** Server-side opaque-token verification. Never logs requests, responses or personal tokens. */
@Component
public class FourAClient {
    private final FourAProperties properties;
    private final HttpClient client;
    private final ObjectMapper json = new ObjectMapper();
    /** Only the identity and scope fields needed by this application leave the verifier. */
    public record Profile(String userId, String username, String displayName,
            String groupId, String groupName, String roleId) {
        public Profile(String userId, String username, String displayName) {
            this(userId, username, displayName, "", "", "");
        }
    }

    @Autowired public FourAClient(FourAProperties properties) {
        this(properties, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(properties.timeoutSeconds))
                .followRedirects(HttpClient.Redirect.NEVER).build());
    }
    FourAClient(FourAProperties properties, HttpClient client) { this.properties = properties; this.client = client; }

    public Profile verify(String token, String systemName) {
        if (!"oneflight".equals(systemName) && !"jingqi".equals(systemName)) throw ApiException.invalid("应用标识无效");
        checkToken(token);
        JsonNode body = post("/api/login/getUserByToken", token, Map.of("token", token, "systemName", systemName));
        if (!"SUCCESS".equals(body.path("code").asText())) {
            if ("OTHER LOGINED".equals(body.path("code").asText())) throw expired();
            if ("oneflight".equals(systemName) && "ERROR".equals(body.path("code").asText())
                    && "账号无权限！请联系管理员".equals(body.path("message").asText())) {
                throw new ApiException(HttpStatus.FORBIDDEN, "PLATFORM_NOT_OPEN", "当前 4A 账号尚未开通一网统飞平台访问权限，请联系管理员");
            }
            // The upstream checks application permission before its single-login check. A jingqi
            // denial must never log the user out of the independently authorized platform.
            if ("jingqi".equals(systemName)) throw new ApiException(HttpStatus.FORBIDDEN, "FLIGHT_PERMISSION_DENIED", "当前 4A 账号没有牍术飞控权限");
            throw expired();
        }
        JsonNode user = body.path("data");
        if (!user.isObject()) throw profileInvalid();
        JsonNode idValue = user.get("userId");
        JsonNode usernameValue = user.get("username");
        if (idValue == null || !(idValue.isTextual() || idValue.isIntegralNumber())
                || usernameValue == null || !usernameValue.isTextual()) throw profileInvalid();
        String id = idValue.asText("");
        String username = usernameValue.asText("");
        JsonNode disabled = user.get("disable");
        if (id.isBlank() || id.length() > 160 || username.isBlank() || username.length() > 160
                // The upstream schema has a nullable disable column. Its verifier treats an
                // explicit null as enabled; a missing or unknown field is still rejected here.
                || disabled == null || !(disabled.isNull() || disabled.isBoolean() || disabled.isIntegralNumber())) throw profileInvalid();
        if (disabled.asBoolean() || (disabled.isIntegralNumber() && disabled.bigIntegerValue().signum() != 0)) throw accountDisabled();
        JsonNode expirationValue = user.get("expiredTime");
        if (expirationValue != null && !expirationValue.isNull() && !expirationValue.isTextual()) throw profileInvalid();
        String expiration = expirationValue == null ? "" : expirationValue.asText("").trim();
        if (!expiration.isBlank()) {
            try {
                Instant expires = expiration(expiration);
                if (!expires.isAfter(Instant.now())) throw expired();
            } catch (ApiException e) { throw e; }
            catch (Exception e) { throw profileInvalid(); }
        }
        JsonNode nameValue = user.get("name");
        if (nameValue == null || nameValue.isNull()) nameValue = user.get("nickname");
        if (nameValue != null && !nameValue.isNull() && !nameValue.isTextual()) throw profileInvalid();
        String name = nameValue == null || nameValue.isNull() ? username : nameValue.asText();
        return new Profile(id, username, bounded(name, 160), scalar(user.get("groupId"), 160),
                scalar(user.get("groupName"), 160), scalar(user.path("userRoles").get("roleId"), 160));
    }

    public boolean logout(String token) {
        try { checkToken(token); return "SUCCESS".equals(post("/api/login/logout", token, Map.of("token", token)).path("code").asText()); }
        catch (RuntimeException e) { return false; }
    }

    private JsonNode post(String path, String token, Map<String, String> body) {
        try {
            var request = HttpRequest.newBuilder(URI.create(properties.issuer + path))
                    .timeout(Duration.ofSeconds(properties.timeoutSeconds))
                    .header("Content-Type", "application/json").header("Accept", "application/json")
                    .header("Authorization", "Bearer " + token)
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body), StandardCharsets.UTF_8)).build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (var stream = response.body()) {
                byte[] bytes = stream.readNBytes(1024 * 1024 + 1);
                if (response.statusCode() != 200 || bytes.length > 1024 * 1024) throw unavailable();
                return json.readTree(bytes);
            }
        } catch (ApiException e) { throw e; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw unavailable(); }
        catch (Exception e) { throw unavailable(); }
    }
    private static void checkToken(String token) {
        if (token == null || token.isBlank() || token.length() > 4096 || token.chars().anyMatch(c -> c < 33 || c > 126)) throw expired();
    }
    private static String scalar(JsonNode value, int max) {
        if (value == null || value.isNull()) return "";
        if (!(value.isTextual() || value.isIntegralNumber())) throw profileInvalid();
        String text = value.asText("").trim();
        if (text.length() > max || text.chars().anyMatch(c -> c < 32 || c == 127)) throw profileInvalid();
        return text;
    }
    private static Instant expiration(String value) {
        try { return Instant.parse(value); } catch (java.time.format.DateTimeParseException ignored) { }
        String normalized = value.replace(' ', 'T');
        try { return OffsetDateTime.parse(normalized, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant(); }
        catch (java.time.format.DateTimeParseException ignored) { }
        ZoneId zone = ZoneId.of("Asia/Shanghai");
        try { return LocalDateTime.parse(normalized, DateTimeFormatter.ISO_LOCAL_DATE_TIME).atZone(zone).toInstant(); }
        catch (java.time.format.DateTimeParseException ignored) { }
        return LocalDate.parse(value, DateTimeFormatter.ISO_LOCAL_DATE).atStartOfDay(zone).toInstant();
    }
    private static String bounded(String value, int max) { return value.substring(0, Math.min(value.length(), max)); }
    public static ApiException expired() { return new ApiException(HttpStatus.UNAUTHORIZED, "FOUR_A_SESSION_EXPIRED", "4A 登录已失效，请重新登录"); }
    private static ApiException profileInvalid() { return new ApiException(HttpStatus.UNAUTHORIZED, "FOUR_A_PROFILE_INVALID", "4A 返回的身份资料格式不兼容，请联系管理员检查认证配置"); }
    private static ApiException accountDisabled() { return new ApiException(HttpStatus.UNAUTHORIZED, "FOUR_A_ACCOUNT_DISABLED", "当前 4A 账号已停用，请联系管理员"); }
    private static ApiException unavailable() { return new ApiException(HttpStatus.BAD_GATEWAY, "FOUR_A_UNAVAILABLE", "4A 身份服务暂不可用，请稍后重试"); }
}

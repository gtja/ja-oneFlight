package com.oneflight.flightcontrol;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.FourASessionService;
import com.oneflight.auth.ScopeService;
import com.oneflight.auth.CurrentUser;
import com.oneflight.common.ApiException;
import com.oneflight.common.ApiResponse;
import com.oneflight.common.PageResult;
import com.oneflight.integration.PersonalFlightDevices;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotBlank;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/flight-control")
public class FlightControlController {
    private final FlightControlProperties properties;
    private final FourASessionService identities;
    private final FlightLaunchTickets tickets;
    private final FlightTargetResolver targets;
    private final FlightEntryPolicy policy;
    private final FlightEntryGrants grants;
    private final PersonalFlightDevices personalDevices;
    private final ScopeService scope;
    private final FlightEntryAudit audit;
    private final ObjectMapper json = new ObjectMapper();

    public FlightControlController(FlightControlProperties properties, FourASessionService identities,
            FlightLaunchTickets tickets, FlightTargetResolver targets, FlightEntryPolicy policy,
            FlightEntryGrants grants, PersonalFlightDevices personalDevices, ScopeService scope, FlightEntryAudit audit) {
        this.properties = properties;
        this.identities = identities;
        this.tickets = tickets;
        this.targets = targets;
        this.policy = policy; this.grants = grants; this.personalDevices = personalDevices;
        this.scope = scope; this.audit = audit;
    }

    @GetMapping("/options")
    public ApiResponse<Map<String, Object>> options() {
        Map<String, Object> options = new LinkedHashMap<>();
        options.put("mode", properties.mode());
        options.put("origin", properties.origin());
        options.put("parentOrigin", properties.parentOrigin());
        options.put("transportMode", properties.transportMode());
        options.put("requiresTask", true);
        options.put("entrySupported", properties.embedded());
        options.put("capabilities", Map.of("microphone", properties.microphoneAvailable()));
        if (!properties.microphoneAvailable()) {
            options.put("message", "当前为 HTTP IP 兼容模式；麦克风、喊话等需要 HTTPS 的功能不可用");
        }
        return ApiResponse.ok(options);
    }

    @GetMapping("/tasks")
    public ApiResponse<PageResult<FlightEntryPolicy.EntryCheck>> tasks(
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String keyword, @RequestParam(required = false) String deviceId,
            @RequestParam(defaultValue = "false") boolean includeExpired) {
        requireEmbedded();
        return ApiResponse.ok(policy.candidates(scope.currentUser(), keyword, deviceId, page, pageSize, includeExpired));
    }

    @GetMapping("/preflight")
    public ApiResponse<FlightEntryPolicy.EntryCheck> preflight(@RequestParam String taskId) {
        requireEmbedded();
        return ApiResponse.ok(policy.check(scope.currentUser(), taskId));
    }

    @PostMapping("/launch")
    public ApiResponse<LaunchResponse> launch(@Valid @RequestBody LaunchRequest body, HttpServletRequest request) {
        requireEmbedded();
        FourASessionService.Identity identity;
        try { identity = identities.requireFlightIdentity(request.getSession(false)); }
        catch (ApiException denied) {
            try {
                var live = identities.requireLiveIdentity(request.getSession(false));
                audit.record(identities.currentUser(live), body.taskId(), "FLIGHT_ENTRY_DENIED", denied.getCode());
            } catch (ApiException ignored) { /* No authenticated actor remains to attribute. */ }
            throw denied;
        }
        CurrentUser user = identities.currentUser(identity);
        try {
            if (body.taskId() == null || body.taskId().isBlank()) throw ApiException.invalid("请选择执行任务并完成放行检查");
            var entry = policy.requireAllowed(user, body.taskId());
            if (body.deviceId() != null && !body.deviceId().isBlank() && !body.deviceId().equals(entry.sourceDeviceId())) {
                throw ApiException.invalid("设备与任务关联不一致，请重新检查");
            }
            var device = personalDevices.require(identity.token(), entry.sourceDeviceId());
            // External I/O must not outlive a concurrent account switch or task reassignment.
            if (!identity.equals(identities.requireLiveIdentity(request.getSession(false)))) throw FlightEntryGrants.invalid();
            requireSame(entry, policy.requireAllowed(identities.currentUser(identity), body.taskId()));
            var target = targets.personalTarget(device);
            String ticket = tickets.issue(request.getSession(false), identity.identityId(), identity.localUserId(), target, entry);
            audit.record(user, body.taskId(), "FLIGHT_ENTRY_CHECK_PASSED", "TICKET_ISSUED");
            return ApiResponse.ok(new LaunchResponse(properties.origin() + "/__oneflight/bootstrap?ticket=" + ticket,
                    properties.origin(), target.message()));
        } catch (ApiException e) {
            audit.record(user, body.taskId(), "FLIGHT_ENTRY_DENIED", e.getCode());
            throw e;
        }
    }

    /** The child has no parent cookie: gateway secret + single-use ticket authenticate this endpoint. */
    @GetMapping(value = "/bootstrap", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> bootstrap(@RequestParam(required = false) String ticket,
            @RequestHeader(value = "X-Oneflight-Gateway-Secret", required = false) String secret) {
        requireGateway(secret);
        Map<String, Object> config = baseConfig("bootstrap");
        HttpStatus status = HttpStatus.OK;
        try {
            var launch = tickets.consume(ticket);
            if (launch.entry() == null) throw FlightLaunchTickets.invalid();
            var identity = identities.requireFlightIdentity(launch.session());
            // Remote identity checks can take seconds: a simultaneous logout must still win.
            tickets.requireLiveSession(launch);
            if (!Objects.equals(identity.identityId(), launch.identityId())
                    || !Objects.equals(identity.localUserId(), launch.localUserId())) throw FlightLaunchTickets.invalid();
            var user = identities.currentUser(identity);
            try {
                var entry = policy.requireAllowed(user, launch.entry().taskId());
                requireSame(launch.entry(), entry);
                var device = personalDevices.require(identity.token(), entry.sourceDeviceId());
                var target = targets.personalTarget(device);
                if (!target.equals(launch.target())) throw FlightLaunchTickets.invalid();
                if (!identity.equals(identities.requireLiveIdentity(launch.session()))) throw FlightEntryGrants.invalid();
                requireSame(entry, policy.requireAllowed(identities.currentUser(identity), entry.taskId()));
                String grant = grants.issue(launch.session(), identity.identityId(), identity.localUserId(), entry.taskId());
                config.put("token", identity.token());
                config.put("targetPath", target.path());
                config.put("message", target.message());
                audit.record(user, entry.taskId(), "FLIGHT_ENTRY_GRANTED", "BOOTSTRAP_ACCEPTED");
                return withEntryCookie(page(config, HttpStatus.OK), grant, false);
            } catch (ApiException e) {
                audit.record(user, launch.entry().taskId(), "FLIGHT_ENTRY_DENIED", e.getCode());
                throw e;
            }
        } catch (ApiException | IllegalStateException e) {
            // No token, exception text, or callback URL is logged or reflected into an error page.
            status = HttpStatus.UNAUTHORIZED;
            config = baseConfig("error");
            config.put("message", "飞控登录状态或启动票据已失效，请返回平台重新进入");
        }
        return page(config, status);
    }

    @GetMapping(value = "/logout-page", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> logoutPage(
            @RequestHeader(value = "X-Oneflight-Gateway-Secret", required = false) String secret,
            @RequestHeader(value = "X-Oneflight-Entry-Grant", required = false) String grant) {
        requireGateway(secret);
        grants.revoke(grant);
        return withEntryCookie(page(baseConfig("logout"), HttpStatus.OK), "", true);
    }

    @GetMapping("/gateway-check")
    public ResponseEntity<Void> gatewayCheck(
            @RequestHeader(value = "X-Oneflight-Gateway-Secret", required = false) String secret,
            @RequestHeader(value = "X-Oneflight-Entry-Grant", required = false) String grantKey,
            @RequestHeader(value = "X-Oneflight-Request-Kind", required = false) String kind) {
        requireGateway(secret);
        var grant = grants.require(grantKey);
        var identity = identities.requireLiveIdentity(grant.session());
        if (!Objects.equals(identity.identityId(), grant.identityId())
                || !Objects.equals(identity.localUserId(), grant.localUserId())) throw FlightEntryGrants.invalid();
        if ("entry".equals(kind)) {
            var user = identities.currentUser(identity);
            try { policy.requireAllowed(user, grant.taskId()); }
            catch (ApiException e) {
                audit.record(user, grant.taskId(), "FLIGHT_ENTRY_DENIED", e.getCode());
                return ResponseEntity.status(HttpStatus.FORBIDDEN).header(HttpHeaders.CACHE_CONTROL, "no-store").build();
            }
        } else if (!"continue".equals(kind)) throw ApiException.forbidden();
        return ResponseEntity.noContent().header(HttpHeaders.CACHE_CONTROL, "no-store").build();
    }

    private static void requireSame(FlightEntryPolicy.Snapshot expected, FlightEntryPolicy.Snapshot actual) {
        if (expected == null || !expected.equals(actual)) {
            throw new ApiException(HttpStatus.CONFLICT, "FLIGHT_ENTRY_CHANGED", "任务、审批或分配信息已变化，请重新检查后进入飞控");
        }
    }

    private ResponseEntity<String> withEntryCookie(ResponseEntity<String> page, String value, boolean clear) {
        var cookie = ResponseCookie.from(FlightEntryGrants.COOKIE, value).path("/").httpOnly(true)
                .sameSite("Lax").secure(!"http-ip".equals(properties.transportMode()));
        if (clear) cookie.maxAge(0);
        return ResponseEntity.status(page.getStatusCode()).headers(page.getHeaders())
                .header(HttpHeaders.SET_COOKIE, cookie.build().toString()).body(page.getBody());
    }

    private Map<String, Object> baseConfig(String mode) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("mode", mode);
        config.put("parentOrigin", properties.parentOrigin());
        config.put("transportMode", properties.transportMode());
        return config;
    }

    private ResponseEntity<String> page(Map<String, Object> config, HttpStatus status) {
        String data;
        try {
            data = json.writeValueAsString(config).replace("&", "\\u0026").replace("<", "\\u003c")
                    .replace(">", "\\u003e").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("无法生成飞控启动页");
        }
        String html = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"referrer\" content=\"no-referrer\"><title>飞行管控</title></head>"
                + "<body><p id=\"oneflight-status\">正在建立飞控登录状态…</p>"
                + "<script id=\"oneflight-bootstrap\" type=\"application/json\">" + data + "</script>"
                + "<script defer src=\"/__oneflight/assets/bootstrap.js\"></script></body></html>";
        return ResponseEntity.status(status)
                .contentType(new MediaType("text", "html", StandardCharsets.UTF_8))
                .header(HttpHeaders.CACHE_CONTROL, "no-store, max-age=0")
                .header(HttpHeaders.PRAGMA, "no-cache")
                .header("Referrer-Policy", "no-referrer")
                .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; "
                        + "style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors " + properties.parentOrigin())
                .body(html);
    }

    private void requireGateway(String supplied) {
        requireEmbedded();
        if (supplied == null || !MessageDigest.isEqual(properties.gatewaySecret().getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8))) throw ApiException.forbidden();
    }

    private void requireEmbedded() {
        if (!properties.embedded()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                "FLIGHT_ENTRY_MODE_UNSUPPORTED", "当前接入模式不支持任务放行，请使用代理嵌入模式");
    }

    public record LaunchRequest(@Size(max = 180) String deviceId, @NotBlank(message = "请选择执行任务") @Size(max = 36) String taskId) { }
    public record LaunchResponse(String url, String origin, String message) { }
}

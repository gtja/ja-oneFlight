package com.oneflight.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.oneflight.common.ApiException;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import java.io.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;

class FourAClientTest {
    HttpClient transport;
    FourAClient client;
    @BeforeEach void setup() {
        transport = mock(HttpClient.class);
        client = new FourAClient(new FourAProperties("local", false, "https://identity.example.test", "https://platform.example.test", 8), transport);
    }
    @SuppressWarnings("unchecked")
    void reply(String body) throws Exception {
        HttpResponse<InputStream> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        when(transport.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn(response);
    }
    @Test void immutableLargeNumericIdIsKeptExactlyAndApplicationIsExplicit() throws Exception {
        reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":9007199254740993123,\"username\":\"operator\",\"disable\":false,\"expiredTime\":\"\"}}");
        assertThat(client.verify("personal-token", "oneflight").userId()).isEqualTo("9007199254740993123");
        var request = ArgumentCaptor.forClass(HttpRequest.class);
        verify(transport).send(request.capture(), any(HttpResponse.BodyHandler.class));
        assertThat(request.getValue().uri().toString()).isEqualTo("https://identity.example.test/api/login/getUserByToken");
        assertThat(request.getValue().headers().firstValue("Authorization")).contains("Bearer personal-token");
        assertThat(request.getValue().timeout()).contains(java.time.Duration.ofSeconds(8));
        assertThat(request.getValue().uri().toString()).doesNotContain("personal-token");
    }
    @Test void freshlyDisabledAndExpiredUsersAreRejected() throws Exception {
        reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\",\"disable\":true}}");
        assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getCode()).isEqualTo("FOUR_A_ACCOUNT_DISABLED"));
        reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\",\"disable\":0,\"expiredTime\":\"2000-01-01 00:00:00\"}}");
        assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOf(ApiException.class);
    }
    @Test void nullableHistoricalDisableIsEnabledButMissingOrUnknownStatusesRemainRejected() throws Exception {
        reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\",\"disable\":null,\"expiredTime\":\"\"}}");
        assertThat(client.verify("token", "oneflight").userId()).isEqualTo("12");
        reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\"}}");
        assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOf(ApiException.class);
        for (String value : new String[]{"true", "1", "-1", "4294967296", "18446744073709551616", "\"false\"", "\"0\"", "{}"}) {
            reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\",\"disable\":" + value + "}}");
            assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOf(ApiException.class);
        }
    }
    @Test void directoryMetadataIsReadWithoutInterpretingEditableLabelsAsBusinessPermissions() throws Exception {
        reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"admin\",\"name\":\"管理员\",\"disable\":false,"
                + "\"groupId\":\"90001,90002\",\"groupName\":\"4A组织\",\"userRoles\":{\"id\":90,\"roleId\":9007199254740993123}}}");
        var profile = client.verify("token", "oneflight");
        assertThat(profile.roleId()).isEqualTo("9007199254740993123");
        assertThat(profile.groupId()).isEqualTo("90001,90002");
        assertThat(profile.displayName()).isEqualTo("管理员");
    }
    @Test void malformedSuccessfulPayloadIsRejected() throws Exception {
        reply("{\"code\":\"SUCCESS\",\"data\":{\"username\":\"operator\"}}");
        assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOf(ApiException.class);
    }
    @Test void flightPermissionDenialIsDistinctFromRevokedToken() throws Exception {
        reply("{\"code\":\"ERROR\",\"message\":\"账号无权限\"}");
        assertThatThrownBy(() -> client.verify("token", "jingqi")).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getCode()).isEqualTo("FLIGHT_PERMISSION_DENIED"));
        reply("{\"code\":\"OTHER LOGINED\"}");
        assertThatThrownBy(() -> client.verify("token", "jingqi")).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.getCode()).isEqualTo("FOUR_A_SESSION_EXPIRED"));
    }
    @Test void knownPlatformPermissionDenialIsDistinctFromExpiredTokenAndUnknownMessagesAreNotReflected() throws Exception {
        reply("{\"code\":\"ERROR\",\"message\":\"账号无权限！请联系管理员\"}");
        assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getCode()).isEqualTo("PLATFORM_NOT_OPEN");
            assertThat(e.getStatus()).isEqualTo(org.springframework.http.HttpStatus.FORBIDDEN);
        });
        reply("{\"code\":\"ERROR\",\"message\":\"arbitrary-upstream-body\"}");
        assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getCode()).isEqualTo("FOUR_A_SESSION_EXPIRED");
            assertThat(e.getMessage()).doesNotContain("arbitrary-upstream-body");
        });
    }
    @Test void malformedSuccessProfilesAreDistinctFromDisabledAccounts() throws Exception {
        for (String data : new String[]{"null", "[]", "{}", "{\"userId\":12,\"username\":\"operator\",\"disable\":\"false\"}",
                "{\"userId\":true,\"username\":\"operator\",\"disable\":false}",
                "{\"userId\":12,\"username\":\"operator\",\"disable\":false,\"name\":{}}"}) {
            reply("{\"code\":\"SUCCESS\",\"data\":" + data + "}");
            assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOfSatisfying(ApiException.class,
                    e -> assertThat(e.getCode()).isEqualTo("FOUR_A_PROFILE_INVALID"));
        }
        for (String disabled : new String[]{"true", "1", "-1", "18446744073709551616"}) {
            reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\",\"disable\":" + disabled + "}}");
            assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOfSatisfying(ApiException.class,
                    e -> assertThat(e.getCode()).isEqualTo("FOUR_A_ACCOUNT_DISABLED"));
        }
    }
    @Test void licenseDateFormatsMatchLocalMidnightAndAbsoluteOffsetSemantics() throws Exception {
        for (String date : new String[]{"2999-01-01", "2999-01-01 00:00:00", "2999-01-01 00:00:00.123",
                "2999-01-01T00:00:00", "2999-01-01T00:00:00.123456789", "2999-01-01T00:00:00Z",
                "2999-01-01T00:00:00+08:00", "2999-01-01 00:00:00.123+08:00"}) {
            reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\",\"disable\":null,\"expiredTime\":\"" + date + "\"}}");
            assertThat(client.verify("token", "oneflight").userId()).isEqualTo("12");
        }
        for (String date : new String[]{java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).toString(),
                "2000-01-01T00:00:00+08:00"}) {
            reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\",\"disable\":false,\"expiredTime\":\"" + date + "\"}}");
            assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOfSatisfying(ApiException.class,
                    e -> assertThat(e.getCode()).isEqualTo("FOUR_A_SESSION_EXPIRED"));
        }
        for (String date : new String[]{"null", "2999-02-30", "2999-02-30 00:00:00", "2999-01-01T25:00:00", "not-a-date"}) {
            reply("{\"code\":\"SUCCESS\",\"data\":{\"userId\":12,\"username\":\"operator\",\"disable\":false,\"expiredTime\":\"" + date + "\"}}");
            assertThatThrownBy(() -> client.verify("token", "oneflight")).isInstanceOfSatisfying(ApiException.class,
                    e -> assertThat(e.getCode()).isEqualTo("FOUR_A_PROFILE_INVALID"));
        }
    }
    @Test void logoutUsesBearerAndDoesNotPropagateUpstreamFailure() throws Exception {
        reply("{\"code\":\"SUCCESS\",\"data\":true}");
        assertThat(client.logout("personal-token")).isTrue();
        var request = ArgumentCaptor.forClass(HttpRequest.class);
        verify(transport).send(request.capture(), any(HttpResponse.BodyHandler.class));
        assertThat(request.getValue().uri().getPath()).isEqualTo("/api/login/logout");
        assertThat(request.getValue().headers().firstValue("Authorization")).contains("Bearer personal-token");
        reply("not json"); assertThat(client.logout("personal-token")).isFalse();
    }
    @Test void tokenHeaderInjectionAndUnknownApplicationsNeverReachTransport() {
        assertThatThrownBy(() -> client.verify("token\r\nheader", "oneflight")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> client.verify("token", "4a")).isInstanceOf(ApiException.class);
        verifyNoInteractions(transport);
    }
    @Test void configurationRequiresFixedHttpsOrigins() {
        assertThatThrownBy(() -> new FourAProperties("4a", false, "https://identity.example.test", "", 8)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FourAProperties("local", false, "http://identity.example.test", "", 8)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FourAProperties("local", false, "https://identity.example.test/path", "", 8)).isInstanceOf(IllegalArgumentException.class);
    }
}

package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.oneflight.auth.*;
import com.oneflight.common.ApiException;
import com.oneflight.integration.PersonalFlightDevices;
import com.oneflight.integration.SourceModels;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class EmbeddedEntryPathTest {
    private final FourASessionService identities = mock(FourASessionService.class);
    private final FlightLaunchTickets tickets = mock(FlightLaunchTickets.class);
    private final FlightEntryPolicy policy = mock(FlightEntryPolicy.class);
    private final PersonalFlightDevices personal = mock(PersonalFlightDevices.class);
    private final FlightTargetResolver targets = new FlightTargetResolver(null, null, null, null);
    private final FlightControlController controller = new FlightControlController(
            new FlightControlProperties("embedded", "https://flight.example", "https://parent.example",
                    "abcdefghijklmnopqrstuvwxyz123456"), identities, tickets, targets, policy,
            new FlightEntryGrants(), personal, mock(ScopeService.class), mock(FlightEntryAudit.class));

    @Test void missingTaskCannotLaunchEvenWithAValidPersonalIdentity() {
        var request = new MockHttpServletRequest(); identity(request);
        assertThatThrownBy(() -> controller.launch(new FlightControlController.LaunchRequest(null, null), request))
                .isInstanceOf(ApiException.class).hasMessageContaining("请选择执行任务");
        verifyNoInteractions(tickets, policy, personal);
    }

    @Test void targetComesFromTheTaskAndPersonalDirectory() {
        var request = new MockHttpServletRequest(); var identity = identity(request);
        var snapshot = new FlightEntryPolicy.Snapshot("task", "plan", "resource", "source-device", 1, 2, 3, "pilot", "fingerprint");
        when(policy.requireAllowed(any(), eq("task"))).thenReturn(snapshot);
        var device = mock(SourceModels.Device.class);
        when(device.id()).thenReturn("source-device"); when(device.type()).thenReturn("UAV");
        when(personal.require(identity.token(), "source-device")).thenReturn(device);
        when(tickets.issue(any(), anyString(), anyString(), any(), eq(snapshot))).thenReturn("opaque-ticket");
        var result = controller.launch(new FlightControlController.LaunchRequest(null, "task"), request).data();
        assertThat(result.url()).isEqualTo("https://flight.example/__oneflight/bootstrap?ticket=opaque-ticket")
                .doesNotContain(identity.token());
        verify(tickets).issue(eq(request.getSession()), eq("identity"), eq("local"),
                eq(new FlightTargetResolver.Target("/control-room/uav/source-device", null)), eq(snapshot));
    }

    @Test void airportsUseTheVerifiedDirectoryWithoutGuessingAircraftIdentity() {
        var device = mock(SourceModels.Device.class);
        when(device.id()).thenReturn("airport"); when(device.name()).thenReturn("机场一"); when(device.type()).thenReturn("UAV_AIRPORT");
        assertThat(targets.personalTarget(device).path()).isEqualTo("/source/UAV_AIRPORT");
        assertThat(targets.personalTarget(device).message()).contains("机场一", "手动选择");
    }

    private FourASessionService.Identity identity(MockHttpServletRequest request) {
        var identity = new FourASessionService.Identity("identity", "external", "local", "personal-test-token");
        when(identities.requireFlightIdentity(request.getSession())).thenReturn(identity);
        when(identities.requireLiveIdentity(request.getSession())).thenReturn(identity);
        when(identities.currentUser(identity)).thenReturn(new CurrentUser("local", "user", "人员", Role.ADMIN, "org", Set.of(), Set.of()));
        return identity;
    }
}

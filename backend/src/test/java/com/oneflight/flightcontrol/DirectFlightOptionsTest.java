package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.oneflight.auth.FourASessionService;
import com.oneflight.common.ApiException;
import org.junit.jupiter.api.Test;

class DirectFlightOptionsTest {
    @Test void unsupportedModesNeverExposeAnUncontrolledShortcut() {
        var identities = mock(FourASessionService.class);
        var tickets = mock(FlightLaunchTickets.class);
        var targets = mock(FlightTargetResolver.class);
        var properties = new FlightControlProperties("direct", "http://127.0.0.1:8089",
                "http://127.0.0.1:8088", "", "http-ip");
        var controller = new FlightControlController(properties, identities, tickets, targets, null, null, null, null, null);

        var options = controller.options().data();
        assertThat(options).containsEntry("mode", "direct")
                .containsEntry("origin", "https://dushu.jing-an.com:32716")
                .containsEntry("parentOrigin", "http://127.0.0.1:8088")
                .containsEntry("requiresTask", true).containsEntry("entrySupported", false)
                .doesNotContainKeys("directUrl", "url", "token", "ticket");
        verifyNoInteractions(identities, tickets, targets);
    }

    @Test void directModeCannotAccidentallyUseTheEmbeddedTokenLaunchEndpoint() {
        var identities = mock(FourASessionService.class);
        var tickets = mock(FlightLaunchTickets.class);
        var targets = mock(FlightTargetResolver.class);
        var controller = new FlightControlController(
                new FlightControlProperties("direct", "", "", ""), identities, tickets, targets, null, null, null, null, null);
        assertThatThrownBy(() -> controller.launch(new FlightControlController.LaunchRequest(null, null), null))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("FLIGHT_ENTRY_MODE_UNSUPPORTED"));
        verifyNoInteractions(identities, tickets, targets);
    }
}

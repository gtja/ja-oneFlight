package com.oneflight.integration;

import com.oneflight.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class UnavailableFlightCommandGateway implements FlightCommandGateway {
    @Override public void execute(String deviceId, Command command) {
        throw new ApiException(HttpStatus.NOT_IMPLEMENTED, "PROVIDER_NOT_CONFIGURED", "真实飞行控制未接入");
    }
}

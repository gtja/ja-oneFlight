package com.oneflight.integration;

public interface FlightCommandGateway {
    enum Command { DISPATCH_TASK, TAKEOFF, RETURN_HOME }
    void execute(String deviceId, Command command);
}

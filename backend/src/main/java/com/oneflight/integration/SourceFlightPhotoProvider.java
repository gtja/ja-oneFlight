package com.oneflight.integration;

import java.time.Instant;
import java.util.List;

public interface SourceFlightPhotoProvider {
    List<SourceFlightPhoto> list(String sourceDeviceId, Instant from, Instant to);

    byte[] image(String relativePath);
}

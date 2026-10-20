package com.oneflight.integration;

import java.util.List;
import java.util.Map;

/** Separate adapter contracts for capabilities requiring further provider contract verification. */
public interface SourceExtensions {
    List<Map<String, Object>> trajectory(String flightId);
    List<Map<String, Object>> media(String deviceId);
    List<Map<String, Object>> detections(String deviceId);
    Map<String, Object> training(String algorithmId);
    void train(String algorithmId);
    void deploy(String algorithmId, String deviceId);
}

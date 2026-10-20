package com.oneflight.integration;

import com.oneflight.common.ApiException;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class UnavailableSourceExtensions implements SourceExtensions {
    private ApiException unavailable(String capability) {
        return new ApiException(HttpStatus.NOT_IMPLEMENTED, "PROVIDER_NOT_CONFIGURED", capability + "未接入");
    }
    @Override public List<Map<String, Object>> trajectory(String flightId) { throw unavailable("历史轨迹"); }
    @Override public List<Map<String, Object>> media(String deviceId) { throw unavailable("实时媒体"); }
    @Override public List<Map<String, Object>> detections(String deviceId) { throw unavailable("识别结果来源"); }
    @Override public Map<String, Object> training(String algorithmId) { throw unavailable("算法训练来源"); }
    @Override public void train(String algorithmId) { throw unavailable("算法训练"); }
    @Override public void deploy(String algorithmId, String deviceId) { throw unavailable("算法部署"); }
}

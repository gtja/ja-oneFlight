package com.oneflight.integration;

import com.oneflight.common.ApiException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** A fixed, read-only lookup using the launching person's own verified 4A token. */
@Service
public class PersonalFlightDevices {
    private final ProviderHttpClient provider;

    public PersonalFlightDevices(ProviderHttpClient provider) { this.provider = provider; }

    public SourceModels.Device require(String token, String sourceId) {
        var tree = provider.personalDeviceTree(token);
        if (tree == null || (!tree.isArray() && !tree.has("roots"))) {
            throw ProviderJson.failure("个人飞控设备目录格式不完整，请稍后重试");
        }
        Map<String, SourceModels.Device> devices = new LinkedHashMap<>();
        DeviceDirectory.collect(tree, null, devices);
        var device = devices.get(sourceId);
        if (device == null) {
            throw new ApiException(HttpStatus.FORBIDDEN, "PERSONAL_FLIGHT_DEVICE_DENIED",
                    "当前 4A 账号没有该设备的飞控访问权限，请联系飞控管理员");
        }
        return device;
    }
}

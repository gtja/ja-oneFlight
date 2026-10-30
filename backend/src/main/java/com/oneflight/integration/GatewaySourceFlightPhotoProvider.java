package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class GatewaySourceFlightPhotoProvider implements SourceFlightPhotoProvider {
    private static final ZoneId SOURCE_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter SOURCE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final int SOURCE_PAGE_SIZE = 9;
    private static final int MAX_SOURCE_PAGES = 100;

    private final ProviderHttpClient http;
    private final String platformCapturePath;

    public GatewaySourceFlightPhotoProvider(
            ProviderHttpClient http,
            @Value("${oneflight.sources.flight-photo-path:/DBApiServer/api/platformCapturePost}") String platformCapturePath) {
        this.http = http;
        this.platformCapturePath = platformCapturePath;
    }

    @Override
    public List<SourceFlightPhoto> list(String sourceDeviceId, Instant from, Instant to) {
        Map<String, SourceFlightPhoto> photos = new LinkedHashMap<>();
        for (int page = 1; page <= MAX_SOURCE_PAGES; page++) {
            JsonNode response = http.flightPhotos(platformCapturePath, Map.of(
                    "deviceId", sourceDeviceId,
                    "type", "PICTURE",
                    "sourceId", "ALL",
                    "startTime", SOURCE_TIME.format(from.atZone(SOURCE_ZONE)),
                    "endTime", SOURCE_TIME.format(to.atZone(SOURCE_ZONE)),
                    "page", page,
                    "pageSize", SOURCE_PAGE_SIZE));
            List<SourceFlightPhoto> pagePhotos = SourceFlightPhotoParser.parse(response);
            pagePhotos.forEach(photo -> photos.putIfAbsent(
                    photo.sourceDeviceId() + "\u0000" + photo.sourceMediaId(), photo));
            if (pagePhotos.size() < SOURCE_PAGE_SIZE) return List.copyOf(photos.values());
        }
        throw ProviderJson.failure("照片数量过多，请缩短查询时间范围后重试");
    }

    @Override
    public byte[] image(String relativePath) {
        return http.sourceImage(relativePath);
    }
}

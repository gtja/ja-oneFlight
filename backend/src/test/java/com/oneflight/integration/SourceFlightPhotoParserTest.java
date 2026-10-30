package com.oneflight.integration;

import com.oneflight.common.ApiException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SourceFlightPhotoParserTest {
    @Test
    void flattensGroupedPhotoRowsAndKeepsExternalIdentifiersAsStrings() throws Exception {
        var response = ProviderJson.JSON.readTree("""
                {"success":true,"data":[[
                  {"id":1234567890123456789,"sourceId":"PHOTOGRAPH","deviceId":"device-A",
                   "actionId":987654321012345678,"actionItemId":123456789012345678,
                   "bid":"public-media-object-1",
                   "sourceName":"森林照片.jpg","photoType":"可见光","type":"PICTURE",
                   "startTime":"2026-10-29 10:00:00","endTime":"2026-10-29 10:00:00",
                   "url":"/ja-media-storage/cloud-sample/photos/a.jpg","longitude":120.1,"latitude":30.2,"height":90}
                ],[{"id":"second","sourceId":"PHOTOGRAPH","deviceId":"device-A",
                   "type":"PICTURE","url":"/ja-media-storage/cloud-sample/photos/b.jpg"}]]}
                """);

        List<SourceFlightPhoto> photos = SourceFlightPhotoParser.parse(response);

        assertEquals(2, photos.size());
        assertEquals("1234567890123456789", photos.getFirst().sourceMediaId());
        assertEquals("987654321012345678", photos.getFirst().sourceActionId());
        assertEquals("public-media-object-1", photos.getFirst().sourceBid());
        assertEquals(Instant.parse("2026-10-29T02:00:00Z"), photos.getFirst().capturedFrom());
        assertEquals("/ja-media-storage/cloud-sample/photos/a.jpg", photos.getFirst().sourcePath());
        assertNull(photos.get(1).capturedFrom());
    }

    @Test
    void rejectsUnsuccessfulEnvelopeAndUnsafeImagePaths() throws Exception {
        var response = ProviderJson.JSON.readTree("{\"success\":false,\"data\":[]}");
        assertEquals("SOURCE_UNAVAILABLE", assertThrows(ApiException.class,
                () -> SourceFlightPhotoParser.parse(response)).getCode());
        assertNull(SourceFlightPhotoParser.safeSourcePath("https://other.example/image.jpg"));
        assertNull(SourceFlightPhotoParser.safeSourcePath("/ja-media-storage/../private.jpg"));
        assertNull(SourceFlightPhotoParser.safeSourcePath("/ja-media-storage/image.jpg?token=hidden"));
        assertEquals("/ja-media-storage/image.jpg",
                SourceFlightPhotoParser.safeSourcePath("/ja-media-storage/image.jpg"));
    }
}

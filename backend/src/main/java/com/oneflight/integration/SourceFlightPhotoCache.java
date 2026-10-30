package com.oneflight.integration;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Short-lived metadata cache used only to resolve same-origin image preview requests. */
final class SourceFlightPhotoCache {
    private static final int MAX_ENTRIES = 10_000;
    private static final long TTL_SECONDS = 600;
    private final Map<Key, Entry> entries = new ConcurrentHashMap<>();

    void put(SourceFlightPhoto photo) {
        prune();
        entries.put(new Key(photo.sourceDeviceId(), photo.sourceMediaId()),
                new Entry(photo, Instant.now().plusSeconds(TTL_SECONDS)));
    }

    SourceFlightPhoto get(String sourceDeviceId, String sourceMediaId) {
        Key key = new Key(sourceDeviceId, sourceMediaId);
        Entry entry = entries.get(key);
        if (entry == null) return null;
        if (!entry.expiresAt().isAfter(Instant.now())) {
            entries.remove(key, entry);
            return null;
        }
        return entry.photo();
    }

    private void prune() {
        Instant now = Instant.now();
        entries.entrySet().removeIf(entry -> !entry.getValue().expiresAt().isAfter(now));
        if (entries.size() >= MAX_ENTRIES) {
            entries.keySet().stream().limit(entries.size() - MAX_ENTRIES + 1L).forEach(entries::remove);
        }
    }

    private record Key(String deviceId, String mediaId) {}
    private record Entry(SourceFlightPhoto photo, Instant expiresAt) {}
}

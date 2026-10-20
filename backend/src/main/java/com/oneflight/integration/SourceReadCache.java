package com.oneflight.integration;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Bounded, short-lived read cache. Keys include the complete permitted device set. */
final class SourceReadCache<T> {
    private record Entry<T>(T value, Instant expiresAt) { }
    private final Map<String, Entry<T>> entries = new ConcurrentHashMap<>();
    private final Clock clock;
    private final Duration ttl;
    SourceReadCache() { this(Clock.systemUTC(), Duration.ofSeconds(30)); }
    SourceReadCache(Clock clock, Duration ttl) { this.clock = clock; this.ttl = ttl; }
    T get(String key) {
        Entry<T> entry = entries.get(key);
        if (entry == null) { return null; }
        if (!entry.expiresAt().isAfter(clock.instant())) { entries.remove(key, entry); return null; }
        return entry.value();
    }
    void put(String key, T value) {
        if (entries.size() >= 128) { entries.clear(); }
        entries.put(key, new Entry<>(value, clock.instant().plus(ttl)));
    }
    void clear() { entries.clear(); }
}

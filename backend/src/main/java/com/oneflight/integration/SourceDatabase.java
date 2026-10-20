package com.oneflight.integration;

import com.oneflight.common.PageResult;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import static com.oneflight.integration.SourceModels.*;

/** Dedicated source pools expose fixed SELECT queries only, separate from the writable business pool. */
@Component
public class SourceDatabase {
    private final HikariDataSource dushuPool;
    private final HikariDataSource icosPool;
    private final JdbcTemplate dushu;
    private final JdbcTemplate icos;
    private final SourceReadCache<PageResult<Flight>> flightCache = new SourceReadCache<>();
    private final SourceReadCache<PageResult<Execution>> executionCache = new SourceReadCache<>();
    private final SourceReadCache<Map<String, FlightTotals>> totalsCache = new SourceReadCache<>();
    private volatile SourceHealth dushuHealth = new SourceHealth("飞行来源库", SourceState.UNCONFIGURED, null, null, "来源库未配置");
    private volatile SourceHealth icosHealth = new SourceHealth("任务执行来源库", SourceState.UNCONFIGURED, null, null, "来源库未配置");
    public SourceDatabase(SourceProperties properties) {
        dushuPool = properties.dushuConfigured() ? pool(properties.dushuJdbcUrl(), properties.dushuUsername(), properties.dushuPassword(), "source-dushu", properties.timeoutSeconds()) : null;
        icosPool = properties.icosConfigured() ? pool(properties.icosJdbcUrl(), properties.icosUsername(), properties.icosPassword(), "source-icos", properties.timeoutSeconds()) : null;
        dushu = dushuPool == null ? null : new JdbcTemplate(dushuPool);
        icos = icosPool == null ? null : new JdbcTemplate(icosPool);
        if (dushu != null) { dushu.setQueryTimeout(properties.timeoutSeconds()); }
        if (icos != null) { icos.setQueryTimeout(properties.timeoutSeconds()); }
        if (dushu != null) { dushuHealth = new SourceHealth("飞行来源库", SourceState.STALE, null, null, "来源库已配置，待验证"); }
        if (icos != null) { icosHealth = new SourceHealth("任务执行来源库", SourceState.STALE, null, null, "来源库已配置，待验证"); }
    }
    private static HikariDataSource pool(String url, String user, String password, String name, int timeout) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url); config.setUsername(user); config.setPassword(password); config.setPoolName(name);
        config.setReadOnly(true); config.setConnectionInitSql("SET SESSION TRANSACTION READ ONLY");
        config.setMaximumPoolSize(3); config.setMinimumIdle(0); config.setConnectionTimeout(timeout * 1000L);
        config.setInitializationFailTimeout(-1); config.setMaxLifetime(600_000); config.setIdleTimeout(300_000);
        return new HikariDataSource(config);
    }
    public Map<String, FlightTotals> totals(Set<String> allowed) {
        require(dushu, "飞行来源库未配置");
        if (allowed.isEmpty()) { return Map.of(); }
        String cacheKey = cacheKey(allowed, null, 1, 1);
        Map<String, FlightTotals> cached = totalsCache.get(cacheKey);
        if (cached != null) { return cached; }
        try {
            String sql = "SELECT device_id,total_flight_sorties,total_flight_time,total_flight_distance,last_report_timestamp FROM iot_device_flight_state WHERE device_id IN (" + placeholders(allowed) + ")";
            Map<String, FlightTotals> result = new LinkedHashMap<>();
            dushu.query(sql, statement -> bind(statement, allowed), rows -> {
                result.put(rows.getString("device_id"), new FlightTotals(nullableLong(rows, "total_flight_sorties"),
                        nullableLong(rows, "total_flight_time"), nullableDouble(rows, "total_flight_distance"), epoch(rows, "last_report_timestamp")));
            });
            dushuHealth = success(dushuHealth); totalsCache.put(cacheKey, Map.copyOf(result)); return result;
        } catch (Exception e) {
            dushuHealth = error(dushuHealth); totalsCache.clear(); flightCache.clear();
            throw ProviderJson.failure("飞行累计统计读取失败，请重试");
        }
    }
    public PageResult<Flight> flights(Set<String> allowed, String deviceId, int page, int pageSize) {
        require(dushu, "飞行来源库未配置");
        Set<String> ids = filter(allowed, deviceId);
        if (ids.isEmpty()) { return new PageResult<>(List.of(), 0, page, pageSize); }
        String cacheKey = cacheKey(allowed, deviceId, page, pageSize);
        PageResult<Flight> cached = flightCache.get(cacheKey);
        if (cached != null) { return cached; }
        try {
            String where = " WHERE device_id IN (" + placeholders(ids) + ")";
            Long total = dushu.queryForObject("SELECT COUNT(*) FROM iot_device_flight_sortie" + where, Long.class, ids.toArray());
            List<Object> args = new ArrayList<>(ids); args.add(pageSize); args.add((long) (page - 1) * pageSize);
            List<Flight> records = dushu.query("SELECT id,device_id,product_key,sortie_no,flight_time,flight_distance,report_timestamp,gmt_modified,settlement_status FROM iot_device_flight_sortie" + where + " ORDER BY report_timestamp DESC,id DESC LIMIT ? OFFSET ?", (row, number) -> new Flight(
                    row.getString("id"), row.getString("device_id"), row.getString("product_key"), row.getString("sortie_no"),
                    nullableLong(row, "flight_time"), nullableDouble(row, "flight_distance"), epoch(row, "report_timestamp"),
                    time(row, "gmt_modified"), settlement(row.getObject("settlement_status")), null, null), args.toArray());
            dushuHealth = success(dushuHealth);
            PageResult<Flight> result = new PageResult<>(records, total == null ? 0 : total, page, pageSize);
            flightCache.put(cacheKey, result); return result;
        } catch (Exception e) { dushuHealth = error(dushuHealth); flightCache.clear(); totalsCache.clear(); throw ProviderJson.failure("飞行来源库读取失败，请重试"); }
    }
    public String requireFlight(String id, Set<String> allowed) {
        require(dushu, "飞行来源库未配置");
        if (allowed.isEmpty() || id == null || !id.matches("[0-9]{1,30}")) {
            throw com.oneflight.common.ApiException.forbidden();
        }
        try {
            List<Object> args = new ArrayList<>(); args.add(id); args.addAll(allowed);
            List<String> devices = dushu.query("SELECT device_id FROM iot_device_flight_sortie WHERE id=? AND device_id IN (" + placeholders(allowed) + ")", (row, number) -> row.getString("device_id"), args.toArray());
            if (devices.isEmpty()) { throw com.oneflight.common.ApiException.missing(); }
            return devices.getFirst();
        } catch (com.oneflight.common.ApiException e) { throw e; }
        catch (Exception e) { throw ProviderJson.failure("飞行来源库读取失败"); }
    }
    public PageResult<Execution> executions(Set<String> allowed, String deviceId, int page, int pageSize) {
        require(icos, "任务执行来源库未配置");
        Set<String> selected = filter(allowed, deviceId);
        if (selected.isEmpty()) { return new PageResult<>(List.of(), 0, page, pageSize); }
        String cacheKey = cacheKey(allowed, deviceId, page, pageSize);
        PageResult<Execution> cached = executionCache.get(cacheKey);
        if (cached != null) { return cached; }
        try {
            // All members of a native action record must remain visible; filtering just one member would leak a mixed-scope record.
            String from = " FROM action_item_record r LEFT JOIN action_record a ON a.id=r.action_record_id LEFT JOIN action_item i ON i.id=r.action_item_id";
            String where = " WHERE r.device_id IN (" + placeholders(selected) + ") AND NOT EXISTS (SELECT 1 FROM action_item_record member WHERE member.action_record_id=r.action_record_id AND (member.device_id IS NULL OR member.device_id NOT IN (" + placeholders(allowed) + ")))";
            List<Object> values = new ArrayList<>(selected); values.addAll(allowed);
            Long total = icos.queryForObject("SELECT COUNT(*)" + from + where, Long.class, values.toArray());
            List<Object> args = new ArrayList<>(values); args.add(pageSize); args.add((long) (page - 1) * pageSize);
            List<Execution> records = icos.query("SELECT r.id,r.action_id,r.action_record_id,r.action_item_id,r.task_record_id,r.task_id,r.device_id,r.start_time,r.end_time,r.gmt_create,a.name,i.status" + from + where + " ORDER BY r.gmt_create DESC,r.id DESC LIMIT ? OFFSET ?", (row, number) -> new Execution(
                    row.getString("id"), row.getString("action_id"), row.getString("action_record_id"), row.getString("action_item_id"),
                    row.getString("task_record_id"), row.getString("task_id"), row.getString("name"), List.of(row.getString("device_id")),
                    null, row.getString("status"), time(row, "start_time"), time(row, "end_time"), time(row, "gmt_create"), "ICOS_ACTION_ITEM_RECORD"), args.toArray());
            icosHealth = success(icosHealth);
            PageResult<Execution> result = new PageResult<>(records, total == null ? 0 : total, page, pageSize);
            executionCache.put(cacheKey, result); return result;
        } catch (Exception e) { icosHealth = error(icosHealth); executionCache.clear(); throw ProviderJson.failure("任务执行来源库读取失败，请重试"); }
    }
    private static String cacheKey(Set<String> allowed, String id, int page, int size) {
        return String.join(",", new java.util.TreeSet<>(allowed)) + "|" + id + "|" + page + "|" + size;
    }
    private static Set<String> filter(Set<String> allowed, String id) {
        if (id == null || id.isBlank()) { return allowed; }
        if (!allowed.contains(id)) { throw com.oneflight.common.ApiException.forbidden(); }
        return Set.of(id);
    }
    private static void require(JdbcTemplate jdbc, String message) { if (jdbc == null) { throw ProviderJson.failure(message); } }
    private static String placeholders(Set<String> values) { return String.join(",", java.util.Collections.nCopies(values.size(), "?")); }
    private static void bind(java.sql.PreparedStatement statement, Set<String> values) throws SQLException {
        int i = 1; for (String value : values) { statement.setString(i++, value); }
    }
    static String settlement(Object value) {
        if (value == null) { return "UNKNOWN"; }
        return value.toString().equals("1") ? "SETTLED" : value.toString().equals("0") ? "PENDING" : "UNKNOWN";
    }
    static Long nullableLong(ResultSet row, String column) throws SQLException { long value = row.getLong(column); return row.wasNull() ? null : value; }
    static Double nullableDouble(ResultSet row, String column) throws SQLException { double value = row.getDouble(column); return row.wasNull() ? null : value; }
    static Instant epoch(ResultSet row, String column) throws SQLException {
        Long value = nullableLong(row, column); return value == null ? null : value > 100_000_000_000L ? Instant.ofEpochMilli(value) : Instant.ofEpochSecond(value);
    }
    static Instant time(ResultSet row, String column) throws SQLException {
        java.time.LocalDateTime value = row.getObject(column, java.time.LocalDateTime.class);
        return value == null ? null : value.atZone(ZoneId.of("Asia/Shanghai")).toInstant();
    }
    private static SourceHealth success(SourceHealth old) {
        Instant now = Instant.now(); return new SourceHealth(old.name(), SourceState.HEALTHY, now, now, "来源库只读查询正常");
    }
    private static SourceHealth error(SourceHealth old) {
        return new SourceHealth(old.name(), SourceState.ERROR, Instant.now(), old.lastSuccessAt(), "来源库连接或查询失败");
    }
    public List<SourceHealth> health() { return List.of(dushuHealth, icosHealth); }
    @org.springframework.scheduling.annotation.Scheduled(initialDelay = 4500, fixedDelay = 60_000)
    public void probe() {
        flightCache.clear(); executionCache.clear(); totalsCache.clear();
        if (dushu != null) { try { dushu.queryForObject("SELECT 1", Integer.class); dushuHealth = success(dushuHealth); } catch (Exception e) { dushuHealth = error(dushuHealth); } }
        if (icos != null) { try { icos.queryForObject("SELECT 1", Integer.class); icosHealth = success(icosHealth); } catch (Exception e) { icosHealth = error(icosHealth); } }
    }
    @PreDestroy public void close() { if (dushuPool != null) { dushuPool.close(); } if (icosPool != null) { icosPool.close(); } }
}

package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneflight.auth.AccessScope;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Consumer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Whitelisted source business directories. Source accounts are never granted local login or pilot roles. */
@Service
public class BusinessSourceCatalog implements AutoCloseable {
    private static final int CIRCLE_SEGMENTS = 64;
    private static final double EARTH_RADIUS_METERS = 6_371_008.8;
    private static final Set<String> KINDS = Set.of("people", "groups", "routes", "airspaces", "plans", "tasks", "events", "media");
    private final DeviceDirectory directory;
    private final AccessScope scope;
    private final JdbcTemplate dushu;
    private final JdbcTemplate icos;
    private final JdbcTemplate identity;
    private final List<HikariDataSource> pools = new ArrayList<>();

    @Autowired
    public BusinessSourceCatalog(SourceProperties properties, DeviceDirectory directory, AccessScope scope,
            @Value("${oneflight.sources.identity-jdbc-url:${SOURCE_IDENTITY_JDBC_URL:}}") String identityUrl,
            @Value("${oneflight.sources.identity-username:${SOURCE_IDENTITY_USERNAME:}}") String identityUser,
            @Value("${oneflight.sources.identity-password:${SOURCE_IDENTITY_PASSWORD:}}") String identityPassword) {
        this.directory = directory; this.scope = scope;
        dushu = jdbc(properties.dushuJdbcUrl(), properties.dushuUsername(), properties.dushuPassword(), "business-source-dushu", properties.timeoutSeconds());
        icos = jdbc(properties.icosJdbcUrl(), properties.icosUsername(), properties.icosPassword(), "business-source-icos", properties.timeoutSeconds());
        identity = jdbc(blank(identityUrl) ? identityUrl(properties.dushuJdbcUrl()) : identityUrl,
                blank(identityUser) ? properties.dushuUsername() : identityUser,
                blank(identityPassword) ? properties.dushuPassword() : identityPassword, "business-source-identity", properties.timeoutSeconds());
    }

    BusinessSourceCatalog(DeviceDirectory directory, AccessScope scope, JdbcTemplate dushu, JdbcTemplate icos, JdbcTemplate identity) {
        this.directory = directory; this.scope = scope; this.dushu = dushu; this.icos = icos; this.identity = identity;
    }

    private JdbcTemplate jdbc(String url, String user, String password, String name, int timeout) {
        if (blank(url) || blank(user) || blank(password)) { return null; }
        HikariConfig config = new HikariConfig(); config.setJdbcUrl(url); config.setUsername(user); config.setPassword(password);
        config.setPoolName(name); config.setReadOnly(true); config.setConnectionInitSql("SET SESSION TRANSACTION READ ONLY");
        config.setMaximumPoolSize(2); config.setMinimumIdle(0); config.setConnectionTimeout(timeout * 1000L);
        config.setInitializationFailTimeout(-1); config.setMaxLifetime(600_000); config.setIdleTimeout(300_000);
        HikariDataSource pool = new HikariDataSource(config); pools.add(pool);
        JdbcTemplate jdbc = new JdbcTemplate(pool); jdbc.setQueryTimeout(timeout); return jdbc;
    }

    static String identityUrl(String url) {
        if (blank(url)) { return null; }
        int start = url.indexOf("//"); int slash = start < 0 ? -1 : url.indexOf('/', start + 2);
        if (slash < 0) { return null; }
        int query = url.indexOf('?', slash);
        return url.substring(0, slash + 1) + "ja-4a" + (query < 0 ? "" : url.substring(query));
    }

    public PageResult<Map<String, Object>> list(String kind, int page, int pageSize) { return list(kind, page, pageSize, null, null); }

    public PageResult<Map<String, Object>> list(String kind, int page, int pageSize, String keyword, String eventType) {
        requireOperator(); pagination(page, pageSize);
        if (keyword != null && keyword.length() > 200) { throw ApiException.invalid("查询关键词过长"); }
        if (eventType != null && eventType.length() > 100) { throw ApiException.invalid("事件类型过长"); }
        if (!KINDS.contains(kind)) { throw ApiException.invalid("未知来源目录"); }
        Snapshot snapshot = snapshot();
        if (snapshot.ids().isEmpty()) { return new PageResult<>(List.of(), 0, page, pageSize); }
        try {
            PageResult<Map<String, Object>> result = switch (kind) {
                case "people" -> people(snapshot, page, pageSize, keyword);
                case "groups" -> groups(snapshot, page, pageSize, keyword);
                case "routes" -> routes(snapshot, page, pageSize, keyword);
                case "airspaces" -> airspaces(snapshot, page, pageSize, keyword);
                case "plans" -> plans(snapshot, page, pageSize, keyword);
                case "tasks" -> tasks(snapshot, page, pageSize, keyword);
                case "events" -> events(snapshot, page, pageSize, keyword, eventType);
                case "media" -> media(snapshot, page, pageSize, keyword);
                default -> throw ApiException.invalid("未知来源目录");
            };
            verify(snapshot); return result;
        } catch (ApiException e) { throw e; }
        catch (Exception e) { throw ProviderJson.failure("来源目录读取失败，请检查连接或访问权限"); }
    }

    public Map<String, Object> summary() {
        requireOperator(); Map<String, Object> result = new LinkedHashMap<>();
        for (String kind : List.of("people", "groups", "routes", "airspaces", "plans", "tasks", "events", "media")) {
            Map<String, Object> item = new LinkedHashMap<>();
            try { item.put("total", list(kind, 1, 1).total()); item.put("status", "HEALTHY"); item.put("message", "真实来源只读目录"); }
            catch (ApiException e) { item.put("total", null); item.put("status", "ERROR"); item.put("message", e.getMessage()); }
            item.put("checkedAt", Instant.now().toString()); result.put(kind, item);
        }
        return result;
    }

    private PageResult<Map<String, Object>> people(Snapshot s, int page, int size, String keyword) {
        if (s.organizations().isEmpty()) { return empty(page, size); }
        String where = " FROM users u LEFT JOIN `groups` g ON g.group_id=u.group_id WHERE u.group_id IN (" + placeholders(s.organizations()) + ")";
        List<Object> args = new ArrayList<>(s.organizations());
        where += keywordClause(keyword, args, "u.name", "CAST(u.user_id AS CHAR(64))");
        return select(require(identity), "SELECT CAST(u.user_id AS CHAR(64)) AS source_id,u.name AS title,u.group_id AS source_organization_code,g.group_name AS source_organization_name,u.disable AS source_disabled,u.create_at AS source_created_at,u.update_at AS source_updated_at",
                where, " ORDER BY u.group_id,u.user_id", args, page, size, "ja-4a", "users", row -> {
                    row.put("title", safeName(Objects.toString(row.get("title"), "来源账号 " + row.get("id"))));
                    row.put("qualificationStatus", "UNKNOWN"); row.put("qualificationNote", "来源账号未提供已核验飞手资质");
                    row.put("sourceStatus", row.get("sourceDisabled") == null ? "UNKNOWN" : Objects.equals(number(row.get("sourceDisabled")), 1d) ? "DISABLED" : "ENABLED");
                });
    }

    private PageResult<Map<String, Object>> groups(Snapshot s, int page, int size, String keyword) {
        if (s.organizations().isEmpty()) { return empty(page, size); }
        String where = " FROM `groups` g WHERE g.group_id IN (" + placeholders(s.organizations()) + ")";
        List<Object> args = new ArrayList<>(s.organizations());
        where += keywordClause(keyword, args, "g.group_name", "g.group_id");
        return select(require(identity), "SELECT g.group_id AS source_id,g.group_name AS title,g.group_parent_id AS source_parent_id,g.group_order AS source_order", where,
                " ORDER BY g.group_order,g.group_id", args, page, size, "ja-4a", "groups", row -> {
                    row.put("sourceOrganizationCode", row.get("sourceId")); row.put("sourceStatus", "UNKNOWN");
                    row.put("scopeNote", "独立来源组织档案，未授予本地调度与审批权限");
                });
    }

    private PageResult<Map<String, Object>> routes(Snapshot s, int page, int size, String keyword) {
        String where = " FROM dji_waypoint_flight_task_template t WHERE t.is_valid='YES' AND EXISTS (SELECT 1 FROM device_smart_task_template st WHERE st.wayline_template_id=t.template_id AND st.default_device_id IN (" + placeholders(s.ids()) + "))";
        List<Object> args = new ArrayList<>(s.ids());
        where += keywordClause(keyword, args, "t.task_name", "t.template_id");
        return select(require(dushu), "SELECT CAST(t.id AS CHAR(64)) AS source_id,t.template_id AS template_id,t.task_name AS title,t.product_key,t.task_type,t.version AS source_version,t.gmt_create AS source_created_at,t.gmt_modified AS source_updated_at,t.task_basic,t.parameters", where,
                " ORDER BY t.gmt_modified DESC,t.id DESC", args, page, size, "dushu", "dji_waypoint_flight_task_template", row -> {
                    Object parameters = row.remove("parameters"); Object basic = row.remove("taskBasic");
                    Map<String, Object> geometry = routeGeometry(parameters);
                    row.put("geometry", geometry); row.put("coordinateReference", "SOURCE_MAP_UNSPECIFIED");
                    row.put("geometryStatus", geometry == null ? "UNKNOWN" : "AVAILABLE"); row.put("sourceStatus", "VALID");
                    JsonNode config = parse(basic); row.put("speedMetersPerSecond", numeric(config, "speed"));
                    row.put("heightMeters", numeric(config, "height")); row.put("returnHeightMeters", numeric(config, "globalRTHHeight"));
                });
    }

    private PageResult<Map<String, Object>> airspaces(Snapshot s, int page, int size, String keyword) {
        String sql = "SELECT CAST(o.id AS CHAR(64)) AS source_id,o.overlay_name AS title,o.overlay_type AS source_shape,o.overlay_positions AS source_geometry,o.overlay_height AS height_meters,o.safety_boundary_distance AS safety_boundary_meters,o.overlay_ext_type AS source_type,o.gmt_create AS source_created_at,o.gmt_modified AS source_updated_at,l.effective_devices AS source_device_ids,l.effective_groups AS source_organization_code FROM ja_zone_overlay o JOIN ja_zone_layer l ON l.id=o.layer_id WHERE o.hide=0 ORDER BY o.id";
        List<Map<String, Object>> rows = query(require(icos), sql, List.of(), "chingchi-icos", "ja_zone_overlay");
        rows.removeIf(row -> !allDevicesAllowed(row.get("sourceDeviceIds"), s.ids()) || !matches(row, keyword));
        for (Map<String, Object> row : rows) {
            JsonNode raw = parse(row.get("sourceGeometry")); row.put("sourceGeometry", raw == null ? null : ProviderJson.JSON.convertValue(raw, Object.class));
            row.put("geometry", zoneGeometry(Objects.toString(row.get("sourceShape"), ""), raw));
            row.put("coordinateReference", "SOURCE_MAP_UNSPECIFIED"); row.put("sourceStatus", "VISIBLE");
            row.put("scopeNote", "来源电子围栏或避障范围，不代表监管空域审批");
        }
        return PageResult.of(rows, page, size);
    }

    private PageResult<Map<String, Object>> plans(Snapshot s, int page, int size, String keyword) {
        String sql = "SELECT CAST(p.id AS CHAR(64)) AS source_id,p.name AS title,p.type AS source_type,p.task_type,p.status AS source_status,p.start_time AS planned_start_at,p.end_time AS planned_end_at,p.cycle_type,p.interval_value,p.execute_time,p.day_of_week,p.day_of_month,p.gmt_create AS source_created_at,p.gmt_modified AS source_updated_at,JSON_UNQUOTE(JSON_EXTRACT(p.action_config,'$.deviceIds')) AS source_device_ids,JSON_UNQUOTE(JSON_EXTRACT(p.action_config,'$.templateId')) AS template_id FROM action_plan p WHERE p.is_valid='YES' AND p.status<>'DELETED' ORDER BY p.gmt_modified DESC,p.id DESC";
        List<Map<String, Object>> rows = query(require(icos), sql, List.of(), "chingchi-icos", "action_plan");
        rows.removeIf(row -> !allDevicesAllowed(row.get("sourceDeviceIds"), s.ids()) || !matches(row, keyword));
        for (Map<String, Object> row : rows) { row.put("reviewStatus", "NOT_RECORDED"); row.put("scopeNote", "外部执行计划，原始状态不代表本平台审核通过"); }
        return PageResult.of(rows, page, size);
    }

    private PageResult<Map<String, Object>> tasks(Snapshot s, int page, int size, String keyword) {
        String where = " FROM action a WHERE COALESCE(a.is_valid,'')<>'NO' AND COALESCE(a.status,'')<>'DELETED' AND EXISTS (SELECT 1 FROM action_item_record r WHERE r.action_id=a.id AND r.device_id IN (" + placeholders(s.ids()) + ")) AND NOT EXISTS (SELECT 1 FROM action_item_record r WHERE r.action_id=a.id AND (r.device_id IS NULL OR r.device_id NOT IN (" + placeholders(s.ids()) + ")))";
        List<Object> args = new ArrayList<>(s.ids()); args.addAll(s.ids());
        where += keywordClause(keyword, args, "a.name", "CAST(a.id AS CHAR(64))");
        return select(require(icos), "SELECT CAST(a.id AS CHAR(64)) AS source_id,a.name AS title,a.status AS source_status,a.is_valid AS source_validity,a.type AS source_type,a.action_scene,CAST(a.action_plan_id AS CHAR(64)) AS source_plan_id,a.gmt_create AS source_created_at,a.gmt_modified AS source_updated_at", where,
                " ORDER BY a.gmt_modified DESC,a.id DESC", args, page, size, "chingchi-icos", "action", row -> {
                    row.put("acceptanceStatus", "NOT_RECORDED"); row.put("scopeNote", "外部行动档案，与本地任务验收流程独立");
                });
    }

    private PageResult<Map<String, Object>> events(Snapshot s, int page, int size, String keyword, String eventType) {
        String where = " FROM event e WHERE e.deleted=0 AND e.device_id IN (" + placeholders(s.ids()) + ")";
        List<Object> args = new ArrayList<>(s.ids());
        where += keywordClause(keyword, args, "e.event_name", "e.event_no", "e.device_name");
        if (eventType != null && !eventType.isBlank()) { where += " AND e.event_type=?"; args.add(eventType); }
        return select(require(icos), "SELECT CAST(e.id AS CHAR(64)) AS source_id,e.event_id,e.event_no,e.event_name AS title,e.device_id,e.device_name,e.event_type,e.level,e.process_status AS source_status,e.event_time AS observed_at,e.gmt_create AS source_created_at,e.gmt_modified AS source_updated_at,e.longitude,e.latitude,e.altitude AS altitude_meters,e.confidence,e.app_id AS algorithm_id,e.image AS image_url,e.source_image AS source_image_url,e.record_path AS video_url", where,
                " ORDER BY e.gmt_create DESC,e.id DESC", args, page, size, "chingchi-icos", "event", row -> {
                    sanitizeUrls(row, "imageUrl", "sourceImageUrl", "videoUrl");
                    row.put("sourceDeviceId", row.get("deviceId")); row.put("sourceType", row.get("eventType")); row.put("eventAt", row.get("observedAt"));
                    row.put("reviewStatus", "PENDING_REVIEW"); row.put("observationTimeStatus", suspiciousTime(row.get("observedAt")) ? "INVALID_SOURCE_TIME" : "REPORTED");
                    row.put("scopeNote", "来源原始识别观测，尚未经本平台人工确认");
                });
    }

    private PageResult<Map<String, Object>> media(Snapshot s, int page, int size, String keyword) {
        String where = " FROM device_media_datasource m WHERE m.device_id IN (" + placeholders(s.ids()) + ")";
        List<Object> args = new ArrayList<>(s.ids());
        where += keywordClause(keyword, args, "m.source_name", "m.device_id");
        return select(require(dushu), "SELECT CAST(m.id AS CHAR(64)) AS source_id,m.source_name AS title,m.device_id,m.type AS media_type,m.source_id AS source_type,CAST(m.action_id AS CHAR(64)) AS source_action_id,CAST(m.action_item_id AS CHAR(64)) AS source_action_item_id,m.start_time AS started_at,m.end_time AS ended_at,m.url,m.longitude,m.latitude,m.width,m.height,m.gmt_create AS source_created_at,m.gmt_modified AS source_updated_at", where,
                " ORDER BY m.gmt_create DESC,m.id DESC", args, page, size, "dushu", "device_media_datasource", row -> {
                    sanitizeUrls(row, "url"); row.put("sourceStatus", "INDEXED"); row.put("availability", "NOT_VERIFIED"); row.put("scopeNote", "真实媒体索引，文件可达性和播放尚未逐条验证");
                });
    }

    private static String keywordClause(String keyword, List<Object> args, String... columns) {
        if (keyword == null || keyword.isBlank()) { return ""; }
        if (keyword.length() > 200) { throw ApiException.invalid("查询关键词过长"); }
        List<String> terms = new ArrayList<>();
        String pattern = "%" + keyword.trim() + "%";
        for (String column : columns) {
            terms.add(column + " LIKE ?");
            args.add(pattern);
        }
        return " AND (" + String.join(" OR ", terms) + ")";
    }
    private static boolean matches(Map<String, Object> row, String keyword) {
        return keyword == null || keyword.isBlank() || (Objects.toString(row.get("title"), "") + " " + row.get("id")).toLowerCase(Locale.ROOT).contains(keyword.trim().toLowerCase(Locale.ROOT));
    }

    private PageResult<Map<String, Object>> select(JdbcTemplate jdbc, String fields, String from, String order, List<Object> args, int page, int size, String system, String entity, Consumer<Map<String, Object>> mapper) {
        Long total = jdbc.queryForObject("SELECT COUNT(*)" + from, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args); pageArgs.add(size); pageArgs.add((long) (page - 1) * size);
        List<Map<String, Object>> rows = query(jdbc, fields + from + order + " LIMIT ? OFFSET ?", pageArgs, system, entity);
        rows.forEach(mapper); return new PageResult<>(rows, Objects.requireNonNull(total), page, size);
    }

    private List<Map<String, Object>> query(JdbcTemplate jdbc, String sql, List<Object> args, String system, String entity) {
        return jdbc.query(sql, (rs, index) -> row(rs, system, entity), args.toArray());
    }

    static Map<String, Object> row(ResultSet rs, String system, String entity) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        ResultSetMetaData metadata = rs.getMetaData();
        for (int i = 1; i <= metadata.getColumnCount(); i++) {
            String name = camel(metadata.getColumnLabel(i).toLowerCase(Locale.ROOT));
            Object value = rs.getObject(i);
            if (value instanceof Timestamp timestamp) {
                value = timestamp.toLocalDateTime().atZone(ZoneId.of("Asia/Shanghai")).toInstant().toString();
            }
            if (value instanceof LocalDateTime date) {
                value = date.atZone(ZoneId.of("Asia/Shanghai")).toInstant().toString();
            }
            row.put(name, value);
        }
        row.put("id", Objects.toString(row.get("sourceId"), ""));
        row.put("sourceSystem", system);
        row.put("sourceEntity", entity);
        row.putIfAbsent("title", entity + " " + row.get("id"));
        return row;
    }

    private Snapshot snapshot() {
        Set<String> ids = new LinkedHashSet<>(directory.allowedIds()); Map<String, SourceModels.Device> devices = new LinkedHashMap<>();
        Set<String> organizations = new LinkedHashSet<>();
        directory.authorized().forEach((id, device) -> {
            if (ids.contains(id)) { devices.put(id, device); if (!blank(device.sourceOrganizationCode())) { organizations.add(device.sourceOrganizationCode()); } }
        });
        return new Snapshot(ids, devices, organizations);
    }
    void verify(Snapshot before) {
        if (!directory.allowedIds().containsAll(before.ids())) { throw ProviderJson.failure("来源授权已变化，请重新读取"); }
        Map<String, SourceModels.Device> after = directory.authorized();
        for (String id : before.ids()) {
            if (!after.containsKey(id) || !before.devices().containsKey(id)
                    || !Objects.equals(before.devices().get(id).sourceOrganizationCode(), after.get(id).sourceOrganizationCode())) {
                throw ProviderJson.failure("来源组织授权已变化，请重新读取");
            }
        }
    }
    void requireOperator() { Role role = scope.currentUser().role(); if (role != Role.ADMIN && role != Role.DISPATCH) { throw ApiException.forbidden(); } }
    static boolean allDevicesAllowed(Object raw, Set<String> allowed) {
        if (raw == null || raw.toString().isBlank()) { return false; }
        String[] ids = raw.toString().split(",", -1);
        return ids.length > 0 && Arrays.stream(ids).allMatch(id -> !id.isBlank() && allowed.contains(id.trim()));
    }
    static Map<String, Object> routeGeometry(Object raw) {
        JsonNode data = parse(raw); if (data == null || !data.path("spaces").isArray()) { return null; }
        List<List<Double>> points = new ArrayList<>();
        for (JsonNode space : data.path("spaces")) {
            if (!"MAP".equals(space.path("spaceType").asText())) { continue; }
            for (JsonNode point : space.path("positions")) {
                Double x = numeric(point, "pointX"), y = numeric(point, "pointY"), z = numeric(point, "pointZ");
                if (x == null || y == null || Math.abs(x) > 180 || Math.abs(y) > 90) { continue; }
                points.add(z == null ? List.of(x, y) : List.of(x, y, z));
            }
        }
        return points.size() < 2 ? null : Map.of("type", "LineString", "coordinates", points);
    }
    static Map<String, Object> zoneGeometry(String shape, JsonNode raw) {
        if (raw == null || !raw.isArray() || raw.isEmpty()) { return null; }
        List<List<Double>> points = new ArrayList<>();
        for (JsonNode p : raw) {
            if (!p.isArray() || p.size() < 2 || !p.get(0).isNumber() || !p.get(1).isNumber()) { return null; }
            double x = p.get(0).doubleValue(), y = p.get(1).doubleValue(); if (Math.abs(x) > 180 || Math.abs(y) > 90) { return null; }
            points.add(List.of(x, y));
        }
        if ("CIRCULAR".equals(shape)) {
            JsonNode center = raw.get(0);
            if (center.size() < 4 || !center.get(3).isNumber() || center.get(3).doubleValue() <= 0) { return null; }
            double longitude = center.get(0).doubleValue();
            double latitude = center.get(1).doubleValue();
            double radius = center.get(3).doubleValue();
            if (radius > 10_000_000) { return null; }
            double distance = radius / EARTH_RADIUS_METERS;
            double centerLatitude = Math.toRadians(latitude);
            double centerLongitude = Math.toRadians(longitude);
            double sinLatitude = Math.sin(centerLatitude);
            double cosLatitude = Math.cos(centerLatitude);
            double sinDistance = Math.sin(distance);
            double cosDistance = Math.cos(distance);
            List<List<Double>> ring = new ArrayList<>();
            for (int i = 0; i <= CIRCLE_SEGMENTS; i++) {
                double bearing = 2 * Math.PI * i / CIRCLE_SEGMENTS;
                double lat2 = Math.asin(sinLatitude * cosDistance + cosLatitude * sinDistance * Math.cos(bearing));
                double lon2 = centerLongitude + Math.atan2(Math.sin(bearing) * sinDistance * cosLatitude,
                        cosDistance - sinLatitude * Math.sin(lat2));
                ring.add(List.of(((Math.toDegrees(lon2) + 540) % 360) - 180, Math.toDegrees(lat2)));
            }
            ring.set(CIRCLE_SEGMENTS, ring.getFirst());
            return Map.of("type", "Polygon", "coordinates", List.of(ring));
        }
        if ("LINE".equals(shape)) { return points.size() < 2 ? null : Map.of("type", "LineString", "coordinates", points); }
        if ("POLYGON".equals(shape) && points.size() >= 3) { if (!points.getFirst().equals(points.getLast())) { points.add(points.getFirst()); } return Map.of("type", "Polygon", "coordinates", List.of(points)); }
        return null;
    }
    private static void sanitizeUrls(Map<String, Object> row, String... keys) {
        for (String key : keys) {
            Object value = row.get(key); if (value == null) { continue; }
            String raw = value.toString();
            try {
                URI uri = URI.create(raw);
                if (uri.isAbsolute() && !Set.of("http", "https").contains(uri.getScheme().toLowerCase(Locale.ROOT))) { row.put(key, null); continue; }
                row.put(key, new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), uri.getPath(), null, null).toString());
            } catch (Exception e) { row.put(key, null); }
        }
    }
    static String safeName(String value) { return value.replaceAll("(?<!\\d)1[3-9]\\d{9}(?!\\d)", "[手机号已隐藏]").replaceAll("(?<!\\d)\\d{17}[\\dXx](?!\\d)", "[证件号已隐藏]"); }
    static String camel(String value) { StringBuilder result = new StringBuilder(); boolean upper = false; for (char c : value.toCharArray()) { if (c == '_') { upper = true; } else { result.append(upper ? Character.toUpperCase(c) : c); upper = false; } } return result.toString(); }
    static JsonNode parse(Object value) { try { return value == null ? null : ProviderJson.JSON.readTree(value.toString()); } catch (Exception e) { return null; } }
    static Double numeric(JsonNode node, String key) {
        if (node == null) { return null; }
        JsonNode field = node.path(key);
        if (!field.isNumber()) { return null; }
        double value = field.doubleValue();
        return Double.isFinite(value) ? value : null;
    }
    private static Double number(Object value) { return value instanceof Boolean b ? b ? 1d : 0d : value instanceof Number n ? n.doubleValue() : null; }
    private static boolean suspiciousTime(Object value) { if (value == null) { return true; } try { return Instant.parse(value.toString()).isBefore(Instant.parse("2000-01-01T00:00:00Z")); } catch (Exception e) { return true; } }
    private static boolean blank(String value) { return value == null || value.isBlank(); }
    private static JdbcTemplate require(JdbcTemplate jdbc) { if (jdbc == null) { throw ProviderJson.failure("来源库未配置"); } return jdbc; }
    private static String placeholders(Collection<?> values) { return String.join(",", Collections.nCopies(values.size(), "?")); }
    private static PageResult<Map<String, Object>> empty(int page, int size) { return new PageResult<>(List.of(), 0, page, size); }
    static void pagination(int page, int size) { if (page < 1 || page > 100_000 || size < 1 || size > 100) { throw ApiException.invalid("分页范围无效"); } }
    @PreDestroy public void close() { pools.forEach(HikariDataSource::close); }
    record Snapshot(Set<String> ids, Map<String, SourceModels.Device> devices, Set<String> organizations) { }
}

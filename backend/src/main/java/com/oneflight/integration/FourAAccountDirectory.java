package com.oneflight.integration;

import com.oneflight.auth.FourAClient;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Administrator-only identity lookup, independent of device and local business organization scope. */
@Service
public class FourAAccountDirectory implements AutoCloseable {
    private static final String COLUMNS = "SELECT CAST(u.user_id AS CHAR(160)) AS external_id,u.username,u.name,"
            + "u.group_id,g.group_name,u.disable";
    private static final String TABLES = " FROM users u LEFT JOIN `groups` g ON g.group_id=u.group_id";
    private final JdbcTemplate jdbc;
    private final HikariDataSource pool;

    public record Account(String externalUserId, String username, String displayName,
            String externalGroupId, String externalGroupName, boolean available, String unavailableReason) {
        public FourAClient.Profile profile() {
            return new FourAClient.Profile(externalUserId, username, displayName, externalGroupId, externalGroupName, "");
        }
    }

    @Autowired
    public FourAAccountDirectory(SourceProperties sources,
            @Value("${oneflight.sources.identity-jdbc-url:${SOURCE_IDENTITY_JDBC_URL:}}") String configuredUrl,
            @Value("${oneflight.sources.identity-username:${SOURCE_IDENTITY_USERNAME:}}") String configuredUsername,
            @Value("${oneflight.sources.identity-password:${SOURCE_IDENTITY_PASSWORD:}}") String configuredPassword) {
        String url = blank(configuredUrl) ? BusinessSourceCatalog.identityUrl(sources.dushuJdbcUrl()) : configuredUrl;
        String username = blank(configuredUsername) ? sources.dushuUsername() : configuredUsername;
        String password = blank(configuredPassword) ? sources.dushuPassword() : configuredPassword;
        if (blank(url) || blank(username) || blank(password)) {
            pool = null;
            jdbc = null;
            return;
        }
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url); config.setUsername(username); config.setPassword(password);
        config.setPoolName("four-a-account-directory"); config.setReadOnly(true);
        config.setConnectionInitSql("SET SESSION TRANSACTION READ ONLY");
        config.setMaximumPoolSize(2); config.setMinimumIdle(0);
        config.setConnectionTimeout(sources.timeoutSeconds() * 1000L);
        config.setInitializationFailTimeout(-1); config.setMaxLifetime(600_000); config.setIdleTimeout(300_000);
        pool = new HikariDataSource(config);
        jdbc = new JdbcTemplate(pool);
        jdbc.setQueryTimeout(sources.timeoutSeconds());
    }

    FourAAccountDirectory(JdbcTemplate jdbc) { this.jdbc = jdbc; this.pool = null; }

    public PageResult<Account> search(int page, int pageSize, String query) {
        if (page < 1 || page > 100000 || pageSize < 1 || pageSize > 100) throw ApiException.invalid("分页范围无效");
        if (query != null && query.length() > 200) throw ApiException.invalid("查询关键词过长");
        requireConfigured();
        String where = "";
        List<Object> arguments = new ArrayList<>();
        if (!blank(query)) {
            String pattern = "%" + query.trim().replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
            where = " WHERE (LOWER(u.username) LIKE LOWER(?) ESCAPE '!' OR LOWER(u.name) LIKE LOWER(?) ESCAPE '!'"
                    + " OR CAST(u.user_id AS CHAR(160)) LIKE ? ESCAPE '!')";
            arguments.add(pattern); arguments.add(pattern); arguments.add(pattern);
        }
        try {
            Long total = jdbc.queryForObject("SELECT COUNT(*)" + TABLES + where, Long.class, arguments.toArray());
            arguments.add(pageSize); arguments.add((page - 1) * pageSize);
            List<Account> accounts = jdbc.query(COLUMNS + TABLES + where + " ORDER BY u.user_id LIMIT ? OFFSET ?",
                    (row, index) -> account(row), arguments.toArray());
            return new PageResult<>(accounts, total == null ? 0 : total, page, pageSize);
        } catch (Exception e) { throw unavailable(); }
    }

    /** Re-read by the exact upstream ID at mutation time; client-supplied names are never trusted. */
    public FourAClient.Profile requireAvailable(String externalUserId) {
        if (!valid(externalUserId, 160)) throw ApiException.invalid("4A账号标识无效");
        requireConfigured();
        List<Account> matches;
        try {
            matches = jdbc.query(COLUMNS + TABLES + " WHERE CAST(u.user_id AS CHAR(160)) = ?",
                    (row, index) -> account(row), externalUserId);
        } catch (Exception e) { throw unavailable(); }
        if (matches.size() != 1) throw new ApiException(HttpStatus.NOT_FOUND, "FOUR_A_ACCOUNT_NOT_FOUND", "4A账号不存在或已删除，请刷新目录");
        Account account = matches.getFirst();
        if (!account.externalUserId().equals(externalUserId))
            throw new ApiException(HttpStatus.NOT_FOUND, "FOUR_A_ACCOUNT_NOT_FOUND", "4A账号标识不匹配，请刷新目录");
        if (!account.available()) throw new ApiException(HttpStatus.BAD_REQUEST, "FOUR_A_ACCOUNT_UNAVAILABLE", account.unavailableReason());
        return account.profile();
    }

    private static Account account(ResultSet row) throws SQLException {
        String id = text(row.getString("external_id"));
        String username = text(row.getString("username"));
        String name = text(row.getString("name"));
        String groupId = text(row.getString("group_id"));
        String groupName = text(row.getString("group_name"));
        Object disabled = row.getObject("disable");
        boolean active = disabled == null || Boolean.FALSE.equals(disabled)
                || disabled instanceof Number number && number.intValue() == 0;
        String reason = !active ? "该账号已在4A停用，请先在4A启用"
                : !valid(id, 160) || !valid(username, 160) || groupId.length() > 160 || hasControls(groupId)
                ? "4A身份资料不完整或格式不兼容，请在4A核对账号" : "";
        return new Account(id, username, bounded(name.isBlank() ? username : name, 160), groupId,
                bounded(groupName, 160), reason.isEmpty(), reason);
    }

    private void requireConfigured() { if (jdbc == null) throw unavailable(); }
    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "FOUR_A_DIRECTORY_UNAVAILABLE", "4A账号目录暂不可用，请检查身份目录只读连接配置后重试");
    }
    private static boolean valid(String value, int maximum) { return !blank(value) && value.length() <= maximum && !hasControls(value); }
    private static boolean hasControls(String value) { return value.chars().anyMatch(c -> c < 32 || c == 127); }
    private static boolean blank(String value) { return value == null || value.isBlank(); }
    private static String text(String value) { return value == null ? "" : value; }
    private static String bounded(String value, int maximum) { return value.substring(0, Math.min(value.length(), maximum)); }
    @Override @PreDestroy public void close() { if (pool != null) pool.close(); }
}

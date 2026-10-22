package com.oneflight.integration;

import com.oneflight.common.ApiException;
import java.util.UUID;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;

class FourAAccountDirectoryTest {
    private JdbcTemplate source() {
        JdbcDataSource source = new JdbcDataSource();
        source.setURL("jdbc:h2:mem:four_a_directory_" + UUID.randomUUID() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        JdbcTemplate jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE users(user_id BIGINT PRIMARY KEY,username VARCHAR(255),name VARCHAR(255),group_id VARCHAR(255),disable INT,password VARCHAR(255),phone VARCHAR(255))");
        jdbc.execute("CREATE TABLE `groups`(group_id VARCHAR(255) PRIMARY KEY,group_name VARCHAR(255))");
        jdbc.update("INSERT INTO `groups` VALUES('external-group','4A组织')");
        jdbc.update("INSERT INTO users VALUES(9007199254740993,'new-user','从未登录用户','external-group',NULL,'secret-password','private-phone'),"
                + "(2,'disabled-user','停用用户','external-group',1,'secret-password','private-phone'),"
                + "(3,'unknown-group','多组织用户','group-one,group-two',0,'secret-password','private-phone'),"
                + "(4,'percent%_user','带通配符账号',NULL,0,'secret-password','private-phone'),"
                + "(5,NULL,'资料待补全',NULL,0,'secret-password','private-phone')");
        return jdbc;
    }

    @Test
    void directoryIncludesUnloggedAccountsAndUnknownGroupsAndPreservesExactStringIds() {
        try (var directory = new FourAAccountDirectory(source())) {
            var all = directory.search(1, 20, null);
            assertThat(all.total()).isEqualTo(5);
            var unlogged = directory.search(1, 20, "从未登录").items().getFirst();
            assertThat(unlogged.externalUserId()).isEqualTo("9007199254740993");
            assertThat(unlogged.available()).isTrue();
            assertThat(unlogged.externalGroupName()).isEqualTo("4A组织");
            assertThat(directory.requireAvailable("9007199254740993").username()).isEqualTo("new-user");
            var unknown = directory.search(1, 20, "unknown-group").items().getFirst();
            assertThat(unknown.available()).isTrue();
            assertThat(unknown.externalGroupName()).isEmpty();
            assertThat(directory.requireAvailable("3").groupId()).isEqualTo("group-one,group-two");
            assertThat(directory.search(1, 20, "%_").items()).extracting(FourAAccountDirectory.Account::username).containsExactly("percent%_user");
            assertThat(directory.search(2, 20, null).items()).isEmpty();
        }
    }

    @Test
    void linkRechecksSourceAndRejectsDisabledMissingAndMalformedAccounts() {
        JdbcTemplate jdbc = source();
        try (var directory = new FourAAccountDirectory(jdbc)) {
            assertThat(directory.search(1, 20, "disabled-user").items().getFirst().available()).isFalse();
            assertThatThrownBy(() -> directory.requireAvailable("2")).isInstanceOfSatisfying(ApiException.class,
                    error -> assertThat(error.getCode()).isEqualTo("FOUR_A_ACCOUNT_UNAVAILABLE"));
            assertThatThrownBy(() -> directory.requireAvailable("5")).isInstanceOf(ApiException.class);
            directory.search(1, 20, "new-user");
            jdbc.update("UPDATE users SET disable=9 WHERE username='new-user'");
            assertThatThrownBy(() -> directory.requireAvailable("9007199254740993")).isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> directory.requireAvailable("9999")).isInstanceOfSatisfying(ApiException.class,
                    error -> assertThat(error.getCode()).isEqualTo("FOUR_A_ACCOUNT_NOT_FOUND"));
            assertThatThrownBy(() -> directory.requireAvailable("3' OR '1'='1")).isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> directory.search(0, 20, null)).isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> directory.search(1, 101, null)).isInstanceOf(ApiException.class);
        }
    }

    @Test
    void unavailableDirectoryFailsClearlyWithoutReturningAnEmptySuccess() {
        try (var directory = new FourAAccountDirectory(null)) {
            assertThatThrownBy(() -> directory.search(1, 20, null)).isInstanceOfSatisfying(ApiException.class,
                    error -> assertThat(error.getCode()).isEqualTo("FOUR_A_DIRECTORY_UNAVAILABLE"));
            assertThatThrownBy(() -> directory.requireAvailable("3")).isInstanceOf(ApiException.class);
        }
    }
}

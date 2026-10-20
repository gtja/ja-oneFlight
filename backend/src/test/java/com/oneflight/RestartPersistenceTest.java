package com.oneflight;

import static org.assertj.core.api.Assertions.assertThat;

import com.oneflight.domain.Task;
import com.oneflight.repository.TaskRepository;
import com.oneflight.repository.UserAccountRepository;

import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import java.nio.file.*;
import java.time.Instant;
import java.util.UUID;

/** Reopens a migrated file database in a second application process lifecycle. */
class RestartPersistenceTest {
    @Test
    void taskAndBootstrapAccountSurviveApplicationRestart() throws Exception {
        Path database = Path.of("target", "restart-" + UUID.randomUUID()).toAbsolutePath();
        String url =
                "jdbc:h2:file:"
                        + database
                        + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_ON_EXIT=FALSE";
        String id;
        try (ConfigurableApplicationContext first = start(url)) {
            var admin =
                    first.getBean(UserAccountRepository.class)
                            .findByUsername("restart-admin")
                            .orElseThrow();
            Task task = new Task();
            task.title = "重启持久化验证";
            task.status = "COMPLETED";
            task.organizationId = admin.organizationId;
            task.region = "杭州市";
            task.createdBy = admin.id;
            task.startAt = Instant.parse("2026-10-15T01:00:00Z");
            task.endAt = Instant.parse("2026-10-15T02:00:00Z");
            task.resultSummary = "测试成果";
            first.getBean(TaskRepository.class).saveAndFlush(task);
            id = task.id;
        }
        try (ConfigurableApplicationContext second = start(url)) {
            Task recovered = second.getBean(TaskRepository.class).findById(id).orElseThrow();
            assertThat(recovered.status).isEqualTo("COMPLETED");
            assertThat(recovered.resultSummary).isEqualTo("测试成果");
            assertThat(second.getBean(UserAccountRepository.class).count()).isEqualTo(1);
        } finally {
            Files.deleteIfExists(Path.of(database + ".mv.db"));
            Files.deleteIfExists(Path.of(database + ".trace.db"));
        }
    }

    private ConfigurableApplicationContext start(String url) {
        return new SpringApplicationBuilder(OneFlightApplication.class)
                .profiles("test")
                .run(
                        "--server.port=0",
                        "--spring.datasource.url=" + url,
                        "--oneflight.bootstrap.username=restart-admin",
                        "--oneflight.bootstrap.password=RestartTestPassword123!",
                        "--oneflight.sources.token=",
                        "--oneflight.sources.dushu-jdbc-url=",
                        "--oneflight.sources.icos-jdbc-url=",
                        "--oneflight.sources.mqtt-url=");
    }
}

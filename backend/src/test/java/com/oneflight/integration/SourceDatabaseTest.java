package com.oneflight.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.oneflight.integration.SourceModels.Execution;
import com.oneflight.integration.SourceModels.Flight;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

/** Synthetic source schemas exercise the public readers without a provider pool or Spring context. */
class SourceDatabaseTest {
    @Test
    void flightsKeepScopePagingNullableMetricsAndSourceTimesAcrossCacheRefresh() {
        JdbcTemplate jdbc = jdbc();
        jdbc.execute("CREATE TABLE iot_device_flight_sortie(id BIGINT,device_id VARCHAR(50),product_key VARCHAR(50),"
                + "sortie_no VARCHAR(50),flight_time BIGINT,flight_distance DOUBLE,report_timestamp BIGINT,"
                + "gmt_modified TIMESTAMP,settlement_status INT)");
        jdbc.update("INSERT INTO iot_device_flight_sortie VALUES(9223372036854775807,'A','product','sortie',"
                + "3601,1200.5,1792540800123,TIMESTAMP '2026-10-22 08:09:10',1),"
                + "(2,'A',NULL,NULL,NULL,NULL,1792540800,NULL,9),"
                + "(3,'B','hidden','hidden',10,20,1792540800999,CURRENT_TIMESTAMP,0)");

        SourceDatabase database = database(jdbc);
        try {
            var first = database.flights(Set.of("A"), null, 1, 1);
            assertEquals(2, first.total());
            Flight flight = first.items().getFirst();
            assertEquals("9223372036854775807", flight.id());
            assertEquals("A", flight.deviceId());
            assertEquals("product", flight.productKey());
            assertEquals("sortie", flight.sortieNo());
            assertEquals(3601L, flight.flightTimeSeconds());
            assertEquals(1200.5, flight.flightDistanceMeters());
            assertEquals(Instant.ofEpochMilli(1792540800123L), flight.reportedAt());
            assertEquals(Instant.parse("2026-10-22T00:09:10Z"), flight.updatedAt());
            assertEquals("SETTLED", flight.settlement());
            assertNull(flight.takeoffAt());
            assertNull(flight.landingAt());

            Flight unknown = database.flights(Set.of("A"), "A", 2, 1).items().getFirst();
            assertEquals("2", unknown.id());
            assertNull(unknown.flightTimeSeconds());
            assertNull(unknown.flightDistanceMeters());
            assertEquals(Instant.ofEpochSecond(1792540800L), unknown.reportedAt());
            assertNull(unknown.updatedAt());
            assertEquals("UNKNOWN", unknown.settlement());

            jdbc.update("INSERT INTO iot_device_flight_sortie VALUES(4,'A',NULL,NULL,0,0,1792540800222,NULL,0)");
            assertEquals(first, database.flights(Set.of("A"), null, 1, 1));
            database.probe();
            var refreshed = database.flights(Set.of("A"), null, 1, 1);
            assertEquals(3, refreshed.total());
            assertEquals("4", refreshed.items().getFirst().id());
            assertEquals(0L, refreshed.items().getFirst().flightTimeSeconds());
            assertEquals(0.0, refreshed.items().getFirst().flightDistanceMeters());
            assertEquals("PENDING", refreshed.items().getFirst().settlement());
        } finally {
            database.close();
        }
    }

    @Test
    void executionsExcludeMixedScopeRecordsAndPreserveNativeIdentifiersAndLocalTimes() {
        JdbcTemplate jdbc = jdbc();
        jdbc.execute("CREATE TABLE action_record(id BIGINT,name VARCHAR(100))");
        jdbc.execute("CREATE TABLE action_item(id BIGINT,status VARCHAR(30))");
        jdbc.execute("CREATE TABLE action_item_record(id BIGINT,action_id BIGINT,action_record_id BIGINT,"
                + "action_item_id BIGINT,task_record_id BIGINT,task_id BIGINT,device_id VARCHAR(50),"
                + "start_time TIMESTAMP,end_time TIMESTAMP,gmt_create TIMESTAMP)");
        jdbc.update("INSERT INTO action_record VALUES(10,'visible'),(20,'mixed'),(30,'hidden')");
        jdbc.update("INSERT INTO action_item VALUES(1,'FINISHED')");
        jdbc.update("INSERT INTO action_item_record VALUES"
                + "(9223372036854775807,100,10,1,101,102,'A',TIMESTAMP '2026-10-22 08:09:10',NULL,"
                + "TIMESTAMP '2026-10-22 09:10:11'),"
                + "(2,200,20,1,201,202,'A',NULL,NULL,CURRENT_TIMESTAMP),"
                + "(3,200,20,1,201,202,'B',NULL,NULL,CURRENT_TIMESTAMP),"
                + "(4,300,30,1,301,302,'B',NULL,NULL,CURRENT_TIMESTAMP)");

        SourceDatabase database = database(jdbc);
        try {
            var result = database.executions(Set.of("A"), null, 1, 20);
            assertEquals(1, result.total());
            Execution execution = result.items().getFirst();
            assertEquals("9223372036854775807", execution.id());
            assertEquals("100", execution.nativeActionId());
            assertEquals("10", execution.nativeActionRecordId());
            assertEquals("1", execution.nativeActionItemId());
            assertEquals("101", execution.nativeTaskRecordId());
            assertEquals("102", execution.nativeTaskId());
            assertEquals("visible", execution.name());
            assertEquals(List.of("A"), execution.deviceIds());
            assertNull(execution.status());
            assertEquals("FINISHED", execution.nativeItemCurrentStatus());
            assertEquals(Instant.parse("2026-10-22T00:09:10Z"), execution.executionStartAt());
            assertNull(execution.executionEndAt());
            assertEquals(Instant.parse("2026-10-22T01:10:11Z"), execution.reportedAt());
            assertEquals("ICOS_ACTION_ITEM_RECORD", execution.provider());
        } finally {
            database.close();
        }
    }

    @Test
    void epochUnitBoundaryAndNullsRemainUnchanged() {
        JdbcTemplate jdbc = jdbc();
        assertNull(jdbc.queryForObject("SELECT CAST(NULL AS BIGINT) AS observed_at",
                (row, number) -> SourceDatabase.epoch(row, "observed_at")));
        assertEquals(Instant.ofEpochSecond(100_000_000_000L), jdbc.queryForObject(
                "SELECT CAST(100000000000 AS BIGINT) AS observed_at",
                (row, number) -> SourceDatabase.epoch(row, "observed_at")));
        assertEquals(Instant.ofEpochMilli(100_000_000_001L), jdbc.queryForObject(
                "SELECT CAST(100000000001 AS BIGINT) AS observed_at",
                (row, number) -> SourceDatabase.epoch(row, "observed_at")));
    }

    private JdbcTemplate jdbc() {
        JdbcDataSource source = new JdbcDataSource();
        source.setURL("jdbc:h2:mem:source_database_" + UUID.randomUUID()
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        return new JdbcTemplate(source);
    }

    private SourceDatabase database(JdbcTemplate jdbc) {
        SourceProperties unconfigured = new SourceProperties(null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, 8);
        SourceDatabase database = new SourceDatabase(unconfigured);
        ReflectionTestUtils.setField(database, "dushu", jdbc);
        ReflectionTestUtils.setField(database, "icos", jdbc);
        return database;
    }
}

package com.oneflight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.domain.BaseRecord;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.AuditEventRepository;
import com.oneflight.repository.ConsultationRepository;
import com.oneflight.repository.FlightPlanRepository;
import com.oneflight.repository.IndustryCaseRepository;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.PlatformSettingRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.repository.UserAccountRepository;
import com.oneflight.service.WorkflowService;
import com.oneflight.web.Requests.OrganizationInput;
import jakarta.persistence.EntityManagerFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@SpringBootTest
@ActiveProfiles("test")
class WorkflowReadTransactionIntegrationTest {
    @Autowired WorkflowService service;
    @Autowired ScopeService scope;
    @Autowired EntityManagerFactory entityManagerFactory;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired TaskRepository tasks;
    @Autowired FlightPlanRepository plans;
    @Autowired ResourceRepository resources;
    @Autowired IndustryCaseRepository cases;
    @Autowired ConsultationRepository consultations;
    @Autowired OrganizationRepository organizations;
    @Autowired UserAccountRepository users;
    @Autowired AuditEventRepository events;
    @Autowired PlatformSettingRepository settings;

    private final List<String> organizationIds = new ArrayList<>();
    private UserAccount account;
    private Statistics statistics;
    private boolean statisticsPreviouslyEnabled;

    @BeforeEach
    void fixture() {
        Organization organization = new Organization();
        organization.title = "事务回归组织";
        organization.organizationId = organization.id;
        organization.region = "杭州市";
        organization.status = "ACTIVE";
        organizations.save(organization);
        organizationIds.add(organization.id);

        account = new UserAccount();
        account.username = "read-transaction-" + UUID.randomUUID();
        account.passwordHash = "!synthetic-no-login";
        account.displayName = "事务回归人员";
        account.role = Role.ADMIN;
        account.organizationId = organization.id;
        account.regions = "杭州市";
        account.deviceIds = "source-device,local-device";
        account.organizationIds = "delegated-org";
        users.save(account);

        statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statisticsPreviouslyEnabled = statistics.isStatisticsEnabled();
        statistics.setStatisticsEnabled(true);
        beginRequest();
        assertThat(AopUtils.isAopProxy(service)).isTrue();
    }

    @AfterEach
    void cleanup() {
        if (statistics != null) statistics.setStatisticsEnabled(statisticsPreviouslyEnabled);
        RequestContextHolder.resetRequestAttributes();
        SecurityContextHolder.clearContext();
        if (account != null) users.deleteById(account.id);
        events.deleteAll(events.findAll().stream()
                .filter(event -> organizationIds.contains(event.organizationId)).toList());
        organizations.deleteAllById(organizationIds);
    }

    @ParameterizedTest
    @EnumSource(Role.class)
    void visibilityLoopKeepsRoleScopeWithoutStartingPerRecordTransactions(Role role) {
        account.role = role;
        users.save(account);
        beginRequest();
        List<BaseRecord> records = List.of(
                resource("AIRSPACE", account.organizationId, "杭州市", null),
                resource("AIRSPACE", "other-org", "杭州市", null),
                resource("AIRSPACE", account.organizationId, "其他区域", null),
                resource("DEVICE", account.organizationId, "杭州市", "source-device"),
                resource("DEVICE", account.organizationId, "杭州市", "ungranted-device"),
                localDevice(),
                task(account.organizationId, account.id),
                task(account.organizationId, "other-pilot"),
                resource("AIRSPACE", "delegated-org", "杭州市", null));
        boolean admin = role == Role.ADMIN;
        List<Boolean> expected = List.of(true, admin, admin, true, admin, true,
                true, role != Role.PILOT, admin || role == Role.DISPATCH);

        // Match controller stream filtering through the real transactional Spring proxy.
        for (int index = 0; index < 1500; index++) {
            int recordIndex = index % records.size();
            assertThat(service.visible(records.get(recordIndex)))
                    .as("role %s, record %s", role, recordIndex)
                    .isEqualTo(expected.get(recordIndex));
        }

        assertThat(statistics.getTransactionCount()).isZero();
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
    }

    @Test
    void repositoryAccessorsDoNotStartTransactions() {
        for (int index = 0; index < 100; index++) {
            assertThat(service.tasks()).isSameAs(tasks);
            assertThat(service.plans()).isSameAs(plans);
            assertThat(service.resources()).isSameAs(resources);
            assertThat(service.cases()).isSameAs(cases);
            assertThat(service.consultations()).isSameAs(consultations);
            assertThat(service.organizations()).isSameAs(organizations);
            assertThat(service.users()).isSameAs(users);
            assertThat(service.events()).isSameAs(events);
            assertThat(service.settings()).isSameAs(settings);
        }
        assertThat(statistics.getTransactionCount()).isZero();
    }

    @Test
    void readHelpersParticipateInAnExistingWriteTransaction() {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            assertThat(service.visible(resource("AIRSPACE", account.organizationId, "杭州市", null)))
                    .isTrue();
            assertThat(service.resources()).isSameAs(resources);
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            assertThat(TransactionSynchronizationManager.isCurrentTransactionReadOnly()).isFalse();
        });

        assertThat(statistics.getTransactionCount()).isEqualTo(1);
        assertThat(statistics.getSuccessfulTransactionCount()).isEqualTo(1);
    }

    @Test
    void businessWriteAndAuditCommitTogetherAndInvalidUpdateRollsBack() {
        Organization created = service.saveOrganization(null,
                new OrganizationInput("事务保存组织", "杭州市", null, null));
        organizationIds.add(created.id);
        assertThat(statistics.getTransactionCount()).isEqualTo(1);
        assertThat(statistics.getSuccessfulTransactionCount()).isEqualTo(1);
        assertThat(organizations.findById(created.id)).get()
                .extracting(organization -> organization.title).isEqualTo("事务保存组织");
        assertThat(events.findAll().stream().filter(event -> created.id.equals(event.entityId)))
                .singleElement().satisfies(event -> assertThat(event.action).isEqualTo("CREATE"));

        statistics.clear();
        assertThatThrownBy(() -> service.saveOrganization(created.id,
                new OrganizationInput("不应保存的名称", "杭州市", created.id, null)))
                .isInstanceOf(ApiException.class).hasMessageContaining("组织不能作为自己的上级");
        assertThat(statistics.getTransactionCount()).isEqualTo(1);
        assertThat(statistics.getSuccessfulTransactionCount()).isZero();
        assertThat(organizations.findById(created.id)).get()
                .extracting(organization -> organization.title).isEqualTo("事务保存组织");
        assertThat(events.findAll().stream().filter(event -> created.id.equals(event.entityId)))
                .hasSize(1);
    }

    @Test
    void nextRequestRechecksReducedPermissionsAndDisabledAccount() {
        Resource otherOrganization = resource("AIRSPACE", "other-org", "杭州市", null);
        assertThat(service.visible(otherOrganization)).isTrue();
        account.role = Role.DEPARTMENT;
        users.save(account);
        beginRequest();
        assertThat(service.visible(otherOrganization)).isFalse();
        assertThat(service.visible(resource("AIRSPACE", account.organizationId, "杭州市", null)))
                .isTrue();

        account.enabled = false;
        users.save(account);
        newRequest();
        assertThatThrownBy(() -> service.visible(otherOrganization)).isInstanceOf(ApiException.class);
    }

    private void beginRequest() {
        newRequest();
        // Identity is checked once per HTTP request; isolate per-record transaction overhead.
        scope.currentUser();
        statistics.clear();
    }

    private void newRequest() {
        RequestContextHolder.setRequestAttributes(
                new ServletRequestAttributes(new MockHttpServletRequest()));
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(account.username, null, List.of()));
    }

    private Resource resource(String kind, String organizationId, String region, String sourceDeviceId) {
        Resource resource = new Resource();
        resource.kind = kind;
        resource.organizationId = organizationId;
        resource.region = region;
        resource.sourceDeviceId = sourceDeviceId;
        return resource;
    }

    private Resource localDevice() {
        Resource resource = resource("DEVICE", account.organizationId, "杭州市", null);
        resource.id = "local-device";
        return resource;
    }

    private Task task(String organizationId, String pilotId) {
        Task task = new Task();
        task.organizationId = organizationId;
        task.region = "杭州市";
        task.pilotId = pilotId;
        return task;
    }
}

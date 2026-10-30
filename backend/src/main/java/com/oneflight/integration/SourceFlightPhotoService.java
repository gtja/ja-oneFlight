package com.oneflight.integration;

import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import com.oneflight.domain.IndustryCase;
import com.oneflight.domain.Resource;
import com.oneflight.domain.SourceMediaLink;
import com.oneflight.domain.Task;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.SourceMediaLinkRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.service.AuditService;
import com.oneflight.service.WorkflowService;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SourceFlightPhotoService {
    private static final String SOURCE_SYSTEM = "DUSHU";
    private static final int MAX_PAGE_SIZE = 100;
    private static final Duration MAX_QUERY_RANGE = Duration.ofDays(31);

    private final SourceFlightPhotoProvider provider;
    private final DeviceDirectory directory;
    private final ScopeService scope;
    private final ResourceRepository resources;
    private final TaskRepository tasks;
    private final SourceMediaLinkRepository links;
    private final WorkflowService workflow;
    private final AuditService audit;
    private final SourceFlightPhotoCache cache = new SourceFlightPhotoCache();

    public SourceFlightPhotoService(
            SourceFlightPhotoProvider provider,
            DeviceDirectory directory,
            ScopeService scope,
            ResourceRepository resources,
            TaskRepository tasks,
            SourceMediaLinkRepository links,
            WorkflowService workflow,
            AuditService audit) {
        this.provider = provider;
        this.directory = directory;
        this.scope = scope;
        this.resources = resources;
        this.tasks = tasks;
        this.links = links;
        this.workflow = workflow;
        this.audit = audit;
    }

    public List<Map<String, Object>> listForTask(String taskId) {
        Task task = workflow.get(workflow.tasks(), taskId);
        scope.requireAccess(task);
        if (task.deviceId == null || task.deviceId.isBlank()
                || task.startAt == null || task.endAt == null || !task.endAt.isAfter(task.startAt)) {
            return List.of();
        }
        Resource assignedDevice = resources.findById(task.deviceId).orElseThrow(ApiException::missing);
        if (!"DEVICE".equals(assignedDevice.kind) || blank(assignedDevice.sourceDeviceId)) {
            return List.of();
        }
        directory.require(assignedDevice.sourceDeviceId);
        Map<String, Map<String, Object>> result = new LinkedHashMap<>();
        if (task.startAt != null && task.endAt != null && task.endAt.isAfter(task.startAt)) {
            listForDevice(assignedDevice.sourceDeviceId, task.startAt, task.endAt, 1, MAX_PAGE_SIZE)
                    .stream()
                    .filter(photo -> Objects.equals(taskId, photo.get("taskId")))
                    .forEach(photo -> result.put(Objects.toString(photo.get("id")), photo));
        }
        for (SourceMediaLink link : links.findByTaskId(taskId)) {
            if (!assignedDevice.sourceDeviceId.equals(link.sourceDeviceId)) continue;
            try {
                directory.require(link.sourceDeviceId);
            } catch (ApiException e) {
                if (e.getStatus() != HttpStatus.FORBIDDEN) throw e;
                continue;
            }
            result.put("DUSHU:" + link.sourceDeviceId + ":" + link.sourceMediaId,
                    linkedPhoto(link, task, visibleCaseId(link), "LINKED"));
        }
        return List.copyOf(result.values());
    }

    public List<Map<String, Object>> listForDevice(
            String sourceDeviceId, Instant from, Instant to, int page, int pageSize) {
        return pageForDevice(sourceDeviceId, from, to, page, pageSize).items();
    }

    public PageResult<Map<String, Object>> pageForDevice(
            String sourceDeviceId, Instant from, Instant to, int page, int pageSize) {
        validateQuery(sourceDeviceId, from, to, page, pageSize);
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT, Role.PILOT);
        directory.require(sourceDeviceId);
        List<SourceFlightPhoto> photos = provider.list(sourceDeviceId, from, to);
        directory.require(sourceDeviceId);
        List<Map<String, Object>> visible = new ArrayList<>();
        List<Task> sourceTasks = assignedTasks(sourceDeviceId);
        List<Task> visibleTasks = sourceTasks.stream().filter(scope::canRead).toList();
        for (SourceFlightPhoto photo : photos) {
            if (!sourceDeviceId.equals(photo.sourceDeviceId()) || !within(photo, from, to)) continue;
            cache.put(photo);
            List<SourcePhotoTaskMatcher.Candidate> matches = taskMatches(photo, visibleTasks);
            List<SourcePhotoTaskMatcher.Candidate> allMatches = taskMatches(photo, sourceTasks);
            SourceMediaLink link = links.findBySourceSystemAndSourceDeviceIdAndSourceMediaId(
                    SOURCE_SYSTEM, sourceDeviceId, photo.sourceMediaId()).orElse(null);
            boolean privilegedDirectoryRead = scope.currentUser().role() == Role.ADMIN
                    || scope.currentUser().role() == Role.DISPATCH;
            if (!privilegedDirectoryRead && link == null && matches.isEmpty()) continue;

            Task linkedTask = link == null ? null : visibleTask(link.taskId);
            if (link != null && link.taskId != null && linkedTask == null) link = null;
            if (linkedTask == null && matches.size() == 1 && allMatches.size() == 1)
                linkedTask = visibleTasks.stream()
                        .filter(task -> task.id.equals(matches.getFirst().taskId()))
                        .findFirst().orElse(null);
            String caseId = link == null ? null : visibleCaseId(link);
            String status = link != null && linkedTask != null
                    ? "LINKED"
                    : matches.size() == 1 && allMatches.size() == 1
                            ? "AUTO_MATCHED" : "NEEDS_ASSOCIATION";
            List<Map<String, Object>> candidateViews = taskOptions(photo.sourceDeviceId(), visibleTasks);
            visible.add(photo.view(
                    linkedTask == null ? null : linkedTask.id,
                    linkedTask == null ? null : linkedTask.title,
                    caseId,
                    status,
                    candidateViews));
        }
        directory.require(sourceDeviceId);
        int fromIndex = Math.min(visible.size(), (page - 1) * pageSize);
        int toIndex = Math.min(visible.size(), fromIndex + pageSize);
        return new PageResult<>(List.copyOf(visible.subList(fromIndex, toIndex)), visible.size(), page, pageSize);
    }

    public List<Map<String, Object>> listForCase(String caseId) {
        IndustryCase industryCase = workflow.get(workflow.cases(), caseId);
        scope.requireAccess(industryCase);
        List<Map<String, Object>> result = new ArrayList<>();
        for (SourceMediaLink link : links.findByCaseId(caseId)) {
            try {
                directory.require(link.sourceDeviceId);
            } catch (ApiException e) {
                if (e.getStatus() != HttpStatus.FORBIDDEN) throw e;
                continue;
            }
            Task task = visibleTask(link.taskId);
            if (task == null) continue;
            result.add(linkedPhoto(link, task, caseId, "LINKED"));
        }
        return List.copyOf(result);
    }

    @Transactional
    public Task linkToTask(String sourceDeviceId, String sourceMediaId, String taskId) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT, Role.PILOT);
        directory.require(sourceDeviceId);
        SourceFlightPhoto photo = cachedPhoto(sourceDeviceId, sourceMediaId);
        Task task = workflow.get(workflow.tasks(), taskId);
        scope.requireAccess(task);
        task = requireSameAssignedDevice(sourceDeviceId, task);
        SourceMediaLink link = saveLink(photo, task, null);
        audit.record("SOURCE_MEDIA", link, "LINK_TASK", "来源飞行照片关联任务 " + task.id);
        return task;
    }

    @Transactional
    public IndustryCase markAsClue(String sourceDeviceId, String sourceMediaId, String taskId) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT);
        directory.require(sourceDeviceId);
        SourceFlightPhoto photo = cachedPhoto(sourceDeviceId, sourceMediaId);
        SourceMediaLink existing = links.findByIdentityForUpdate(
                SOURCE_SYSTEM, sourceDeviceId, sourceMediaId).orElse(null);
        if (existing != null && existing.caseId != null) {
            return workflow.get(workflow.cases(), existing.caseId);
        }
        Task task = taskId == null || taskId.isBlank()
                ? uniqueMatchedTask(photo)
                : workflow.get(workflow.tasks(), taskId);
        scope.requireAccess(task);
        task = requireSameAssignedDevice(sourceDeviceId, task);
        IndustryCase created = workflow.createCaseFromDataResult(task.id, photo.title());
        SourceMediaLink link = saveLink(photo, task, created.id);
        audit.record("SOURCE_MEDIA", link, "CLUE_LINK", "来源飞行照片关联疑似线索 " + created.id);
        return created;
    }

    public SourceImage preview(String sourceDeviceId, String sourceMediaId, String caseId) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT, Role.PILOT);
        directory.require(sourceDeviceId);
        String path;
        if (caseId != null && !caseId.isBlank()) {
            IndustryCase industryCase = workflow.get(workflow.cases(), caseId);
            scope.requireAccess(industryCase);
            SourceMediaLink link = links.findBySourceSystemAndSourceDeviceIdAndSourceMediaId(
                            SOURCE_SYSTEM, sourceDeviceId, sourceMediaId)
                    .filter(candidate -> Objects.equals(candidate.caseId, caseId))
                    .orElseThrow(ApiException::missing);
            if (visibleTask(link.taskId) == null) throw ApiException.forbidden();
            path = link.sourcePath;
        } else {
            SourceFlightPhoto photo = cachedPhoto(sourceDeviceId, sourceMediaId);
            if (!canSeePhoto(photo)) throw ApiException.forbidden();
            path = photo.sourcePath();
        }
        String safePath = SourceFlightPhotoParser.safeSourcePath(path);
        if (safePath == null) throw ApiException.invalid("来源照片路径无效");
        byte[] bytes = provider.image(safePath);
        String contentType = imageType(bytes);
        directory.require(sourceDeviceId);
        return new SourceImage(bytes, contentType);
    }

    private List<Task> visibleTasks(String sourceDeviceId) {
        return assignedTasks(sourceDeviceId).stream().filter(scope::canRead).toList();
    }

    private List<Task> assignedTasks(String sourceDeviceId) {
        List<Task> assigned = new ArrayList<>();
        for (Resource device : resources.findByKindAndSourceDeviceId("DEVICE", sourceDeviceId)) {
            for (Task task : tasks.findByDeviceIdAndStatusNot(device.id, "CANCELLED")) {
                assigned.add(task);
            }
        }
        return assigned.stream().distinct().sorted(Comparator.comparing(
                (Task task) -> task.startAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(task -> task.id)).toList();
    }

    private List<SourcePhotoTaskMatcher.Candidate> taskMatches(
            SourceFlightPhoto photo, List<Task> candidateTasks) {
        Map<String, String> sourceIdsByLocalDevice = new LinkedHashMap<>();
        candidateTasks.forEach(task -> resources.findById(task.deviceId).ifPresent(device ->
                sourceIdsByLocalDevice.put(task.deviceId, device.sourceDeviceId)));
        return SourcePhotoTaskMatcher.candidates(
                photo.sourceDeviceId(), photo.capturedFrom(), photo.capturedTo(),
                candidateTasks.stream().map(task -> new SourcePhotoTaskMatcher.Candidate(
                        task.id,
                        task.title,
                        sourceIdsByLocalDevice.get(task.deviceId),
                        task.status,
                        task.startAt,
                        task.endAt)).toList());
    }

    private List<Map<String, Object>> taskOptions(String sourceDeviceId, List<Task> candidates) {
        return candidates.stream()
                .filter(task -> task.startAt != null && task.endAt != null)
                .limit(100)
                .map(task -> Map.<String, Object>of(
                        "id", task.id,
                        "title", task.title,
                        "status", task.status,
                        "startAt", task.startAt,
                        "endAt", task.endAt,
                        "sourceDeviceId", sourceDeviceId))
                .toList();
    }

    private Task uniqueMatchedTask(SourceFlightPhoto photo) {
        List<Task> sourceTasks = assignedTasks(photo.sourceDeviceId());
        List<SourcePhotoTaskMatcher.Candidate> matches = taskMatches(photo, sourceTasks);
        if (matches.size() != 1) throw ApiException.invalid("请先明确关联的任务");
        Task task = sourceTasks.stream().filter(candidate -> candidate.id.equals(matches.getFirst().taskId()))
                .findFirst().orElseThrow(ApiException::missing);
        scope.requireAccess(task);
        return task;
    }

    private Task requireSameAssignedDevice(String sourceDeviceId, Task task) {
        Task lockedTask = tasks.findLockedById(task.id).orElseThrow(ApiException::missing);
        scope.requireAccess(lockedTask);
        if (lockedTask.deviceId == null || lockedTask.deviceId.isBlank())
            throw ApiException.invalid("来源照片只能关联已分配设备的任务");
        Resource device = resources.findLockedById(lockedTask.deviceId).orElseThrow(ApiException::missing);
        if (!"DEVICE".equals(device.kind)
                || !Objects.equals(device.sourceDeviceId, sourceDeviceId)) {
            throw ApiException.invalid("来源照片设备与任务分配设备不一致");
        }
        return lockedTask;
    }

    private SourceMediaLink saveLink(SourceFlightPhoto photo, Task task, String caseId) {
        SourceMediaLink link = links.findByIdentityForUpdate(
                        SOURCE_SYSTEM, photo.sourceDeviceId(), photo.sourceMediaId())
                .orElseGet(SourceMediaLink::new);
        if (link.caseId != null && caseId != null && !link.caseId.equals(caseId))
            throw ApiException.invalid("来源照片已关联其他场景线索");
        if (link.taskId != null && !link.taskId.equals(task.id))
            throw ApiException.invalid("来源照片已关联其他任务");
        link.sourceSystem = SOURCE_SYSTEM;
        link.sourceMediaId = photo.sourceMediaId();
        link.sourceDeviceId = photo.sourceDeviceId();
        link.sourceActionId = photo.sourceActionId();
        link.sourceActionItemId = photo.sourceActionItemId();
        link.sourceRecordId = photo.sourceId();
        link.sourceBid = photo.sourceBid();
        link.sourceName = photo.sourceName();
        link.sourceMediaType = photo.type();
        link.photoType = photo.photoType();
        link.sourcePath = photo.sourcePath();
        link.capturedFrom = photo.capturedFrom();
        link.capturedTo = photo.capturedTo();
        link.longitude = photo.longitude();
        link.latitude = photo.latitude();
        link.sourceHeight = photo.sourceHeight();
        link.title = photo.title();
        link.status = "LINKED";
        link.organizationId = task.organizationId;
        link.region = task.region;
        link.taskId = task.id;
        link.caseId = caseId == null ? link.caseId : caseId;
        link.linkedBy = scope.currentUser().id();
        link.linkedAt = Instant.now();
        link.createdBy = link.createdBy == null ? scope.currentUser().id() : link.createdBy;
        return links.saveAndFlush(link);
    }

    private Map<String, Object> linkedPhoto(
            SourceMediaLink link, Task task, String caseId, String associationStatus) {
        SourceFlightPhoto photo = new SourceFlightPhoto(
                link.sourceMediaId,
                link.sourceRecordId,
                link.sourceName,
                link.sourceDeviceId,
                link.sourceActionId,
                link.sourceActionItemId,
                link.sourceBid,
                link.sourceMediaType,
                link.photoType,
                link.capturedFrom,
                link.capturedTo,
                link.longitude,
                link.latitude,
                link.sourceHeight,
                link.sourcePath);
        return photo.view(task.id, task.title, caseId, associationStatus, List.of());
    }

    private SourceMediaLink visibleLink(String sourceDeviceId, String sourceMediaId) {
        return links.findBySourceSystemAndSourceDeviceIdAndSourceMediaId(
                SOURCE_SYSTEM, sourceDeviceId, sourceMediaId).orElse(null);
    }

    private String visibleCaseId(SourceMediaLink link) {
        if (link.caseId == null) return null;
        try {
            return workflow.get(workflow.cases(), link.caseId).id;
        } catch (ApiException e) {
            return null;
        }
    }

    private Task visibleTask(String taskId) {
        if (taskId == null) return null;
        try {
            Task task = workflow.get(workflow.tasks(), taskId);
            return scope.canRead(task) ? task : null;
        } catch (ApiException e) {
            return null;
        }
    }

    private SourceFlightPhoto cachedPhoto(String sourceDeviceId, String sourceMediaId) {
        SourceFlightPhoto photo = cache.get(sourceDeviceId, sourceMediaId);
        if (photo == null) throw new ApiException(HttpStatus.CONFLICT,
                "SOURCE_MEDIA_EXPIRED", "来源照片信息已过期，请重新查询");
        if (!sourceDeviceId.equals(photo.sourceDeviceId())) throw ApiException.forbidden();
        return photo;
    }

    private boolean canSeePhoto(SourceFlightPhoto photo) {
        Role role = scope.currentUser().role();
        if (role == Role.ADMIN || role == Role.DISPATCH) return true;
        SourceMediaLink link = visibleLink(photo.sourceDeviceId(), photo.sourceMediaId());
        if (link != null && visibleTask(link.taskId) != null) return true;
        return !taskMatches(photo, visibleTasks(photo.sourceDeviceId())).isEmpty();
    }

    private void validateQuery(String sourceDeviceId, Instant from, Instant to, int page, int pageSize) {
        if (blank(sourceDeviceId)) throw ApiException.invalid("请选择来源设备");
        if (from == null || to == null || !to.isAfter(from))
            throw ApiException.invalid("请提供有效的照片查询时间范围");
        if (Duration.between(from, to).compareTo(MAX_QUERY_RANGE) > 0)
            throw ApiException.invalid("单次照片查询时间范围不能超过31天");
        if (page < 1 || page > 100_000 || pageSize < 1 || pageSize > MAX_PAGE_SIZE)
            throw ApiException.invalid("分页范围无效");
    }

    private static boolean within(SourceFlightPhoto photo, Instant from, Instant to) {
        Instant captured = photo.capturedFrom();
        return captured != null && !captured.isBefore(from) && !captured.isAfter(to);
    }

    private String imageType(byte[] bytes) {
        if (bytes == null || bytes.length < 12) throw ApiException.invalid("来源照片内容无效");
        if ((bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff)
            return "image/jpeg";
        if ((bytes[0] & 0xff) == 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G')
            return "image/png";
        if (bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F') return "image/gif";
        if (bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
                && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P')
            return "image/webp";
        throw ApiException.invalid("来源返回的内容不是支持的图片格式");
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    public record SourceImage(byte[] bytes, String contentType) {}
}

package com.oneflight.web;

import com.oneflight.auth.*;
import com.oneflight.common.*;
import com.oneflight.domain.*;
import com.oneflight.repository.AttachmentRepository;
import com.oneflight.domain.AttachmentShareRequest;
import com.oneflight.service.*;
import com.oneflight.web.Requests.AttachmentQualityInput;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.*;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/attachments")
public class AttachmentController {
    private final AttachmentRepository attachments;
    private final WorkflowService service;
    private final ScopeService scope;
    private final AuditService audit;
    private final AttachmentResourceService attachmentResources;
    private final Path directory;

    public AttachmentController(
            AttachmentRepository attachments,
            WorkflowService service,
            ScopeService scope,
            AuditService audit,
            AttachmentResourceService attachmentResources,
            @Value("${oneflight.upload-directory:./data/uploads}") String directory) {
        this.attachments = attachments;
        this.service = service;
        this.scope = scope;
        this.audit = audit;
        this.attachmentResources = attachmentResources;
        this.directory = Path.of(directory).toAbsolutePath().normalize();
    }

    private BaseRecord linked(String type, String id) {
        return "TASK".equals(type)
                ? service.get(service.tasks(), id)
                : "CASE".equals(type) ? service.get(service.cases(), id) : invalid();
    }

    private BaseRecord invalid() {
        throw ApiException.invalid("附件须关联任务或线索");
    }

    @GetMapping
    public ApiResponse<?> list(
            @RequestParam(required = false) String taskId,
            @RequestParam(required = false) String caseId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        String type = taskId != null ? "TASK" : "CASE";
        String id = taskId != null ? taskId : caseId;
        if (id == null) {
            Map<String, AttachmentShareRequest> grants =
                    attachmentResources.activeGrantsByAttachment();
            List<Map<String, Object>> visible = attachments.findAll().stream()
                    .map(attachment -> {
                        try {
                            BaseRecord record = linked(attachment.entityType, attachment.entityId);
                            return attachmentView(attachment, record, false, null);
                        } catch (ApiException e) {
                            AttachmentShareRequest grant = grants.get(attachment.id);
                            return grant == null
                                    ? null
                                    : attachmentView(attachment, null, true, grant.expiresAt);
                        }
                    })
                    .filter(Objects::nonNull)
                    .toList();
            return ApiResponse.ok(PageResult.of(visible, page, pageSize));
        }
        linked(type, id);
        return ApiResponse.ok(
                PageResult.of(
                        attachments.findByEntityId(id).stream()
                                .filter(x -> type.equals(x.entityType))
                                .map(attachment -> attachmentView(
                                        attachment, linked(attachment.entityType, attachment.entityId), false, null))
                                .toList(),
                        page,
                        pageSize));
    }

    @PostMapping
    @Transactional
    public ApiResponse<?> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String taskId,
            @RequestParam(required = false) String caseId)
            throws java.io.IOException {
        if ((taskId == null) == (caseId == null)) throw ApiException.invalid("附件须关联一个任务或线索");
        if (file.isEmpty() || file.getSize() > 100L * 1024 * 1024)
            throw ApiException.invalid("附件大小须为1字节至100MB");
        String type = taskId != null ? "TASK" : "CASE";
        BaseRecord target = linked(type, taskId != null ? taskId : caseId);
        if (target instanceof Task t && Set.of("COMPLETED", "CANCELLED").contains(t.status))
            throw ApiException.invalid("已结束任务不能上传成果");
        if (target instanceof IndustryCase c && "ARCHIVED".equals(c.status))
            throw ApiException.invalid("已归档线索不能上传证据");
        Attachment a = new Attachment();
        a.entityType = type;
        a.entityId = target.id;
        a.organizationId = target.organizationId;
        a.region = target.region;
        a.uploadedBy = scope.currentUser().id();
        String original = file.getOriginalFilename();
        a.filename = (original == null ? "附件" : original.replace('\\', '/'));
        a.filename =
                a.filename.substring(a.filename.lastIndexOf('/') + 1).replaceAll("[\\r\\n]", "");
        if (a.filename.length() > 200) a.filename = a.filename.substring(a.filename.length() - 200);
        a.contentType =
                file.getContentType() == null ? "application/octet-stream" : file.getContentType();
        a.size = file.getSize();
        Files.createDirectories(directory);
        Path output = directory.resolve(a.id);
        try (var stream = file.getInputStream()) {
            Files.copy(stream, output, StandardCopyOption.REPLACE_EXISTING);
        }
        try {
            attachments.saveAndFlush(a);
            audit.record("ATTACHMENT", a.id, a.organizationId, a.region, "UPLOAD", a.filename);
        } catch (RuntimeException ex) {
            Files.deleteIfExists(output);
            throw ex;
        }
        return ApiResponse.ok(a.view());
    }

    @PatchMapping("/{id}/quality")
    @Transactional
    public ApiResponse<?> reviewQuality(
            @PathVariable String id, @jakarta.validation.Valid @RequestBody AttachmentQualityInput input) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        Attachment attachment = attachments.findById(id).orElseThrow(ApiException::missing);
        linked(attachment.entityType, attachment.entityId);
        if (attachment.archivedAt != null)
            throw ApiException.invalid("已归档成果不能修改质检结果");
        if ("NEEDS_SUPPLEMENT".equals(input.decision())
                && (input.note() == null || input.note().isBlank()))
            throw ApiException.invalid("要求补传时请填写原因");
        attachment.qualityStatus = input.decision();
        attachment.qualityNote = input.note() == null ? null : input.note().trim();
        attachment.reviewedBy = scope.currentUser().id();
        attachment.reviewedAt = java.time.Instant.now();
        Attachment saved = attachments.saveAndFlush(attachment);
        audit.record("ATTACHMENT", saved.id, saved.organizationId, saved.region,
                input.decision(), saved.qualityNote);
        return ApiResponse.ok(attachmentView(saved, linked(saved.entityType, saved.entityId), false, null));
    }

    @PostMapping("/{id}/archive")
    @Transactional
    public ApiResponse<?> archive(@PathVariable String id) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        Attachment attachment = attachments.findById(id).orElseThrow(ApiException::missing);
        BaseRecord record = linked(attachment.entityType, attachment.entityId);
        if (!"PASSED".equals(attachment.qualityStatus))
            throw ApiException.invalid("质检通过后才能归档");
        if (attachment.archivedAt != null) throw ApiException.invalid("成果已经归档");
        attachment.archivedBy = scope.currentUser().id();
        attachment.archivedAt = java.time.Instant.now();
        Attachment saved = attachments.saveAndFlush(attachment);
        audit.record("ATTACHMENT", saved.id, saved.organizationId, saved.region, "ARCHIVE", saved.filename);
        return ApiResponse.ok(attachmentView(saved, record, false, null));
    }

    @GetMapping({"/{id}/content", "/{id}/download"})
    public ResponseEntity<org.springframework.core.io.Resource> download(@PathVariable String id) {
        Attachment a = attachments.findById(id).orElseThrow(ApiException::missing);
        requireAttachmentAccess(a);
        Path file = directory.resolve(a.id).normalize();
        if (!file.startsWith(directory) || !Files.isRegularFile(file)) throw ApiException.missing();
        return ResponseEntity.ok()
                .header("X-Content-Type-Options", "nosniff")
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment()
                                .filename(a.filename, java.nio.charset.StandardCharsets.UTF_8)
                                .build()
                                .toString())
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(a.size)
                .body(new FileSystemResource(file));
    }

    @GetMapping("/{id}/preview")
    public ResponseEntity<org.springframework.core.io.Resource> preview(@PathVariable String id)
            throws java.io.IOException {
        Attachment a = attachments.findById(id).orElseThrow(ApiException::missing);
        requireAttachmentAccess(a);
        Path file = directory.resolve(a.id).normalize();
        if (!file.startsWith(directory) || !Files.isRegularFile(file)) throw ApiException.missing();
        String contentType = previewImageType(file);
        return ResponseEntity.ok()
                .header("X-Content-Type-Options", "nosniff")
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.inline()
                                .filename(a.filename, java.nio.charset.StandardCharsets.UTF_8)
                                .build()
                                .toString())
                .contentType(MediaType.parseMediaType(contentType))
                .contentLength(a.size)
                .body(new FileSystemResource(file));
    }

    private void requireAttachmentAccess(Attachment attachment) {
        try {
            linked(attachment.entityType, attachment.entityId);
        } catch (ApiException e) {
            if (!attachmentResources.canReadShared(attachment)) throw e;
        }
    }

    private Map<String, Object> attachmentView(
            Attachment attachment, BaseRecord record, boolean shared, java.time.Instant shareExpiresAt) {
        Map<String, Object> view = new LinkedHashMap<>(attachment.view());
        view.put("entityTitle", shared ? "共享成果" : record.title);
        view.put("entityStatus", shared ? null : record.status);
        view.put("shared", shared);
        view.put("organizationId", shared ? null : attachment.organizationId);
        view.put("region", attachment.region);
        view.put("status", attachment.archivedAt == null ? attachment.qualityStatus : "ARCHIVED");
        if (shared) {
            view.remove("entityId");
            view.remove("taskId");
            view.remove("caseId");
            view.remove("qualityNote");
            view.put("shareExpiresAt", shareExpiresAt);
        }
        return view;
    }

    private String previewImageType(Path file) throws java.io.IOException {
        byte[] header = new byte[12];
        int length;
        try (var input = Files.newInputStream(file)) {
            length = input.read(header);
        }
        if (length >= 3
                && (header[0] & 0xff) == 0xff
                && (header[1] & 0xff) == 0xd8
                && (header[2] & 0xff) == 0xff) return "image/jpeg";
        if (length >= 8
                && (header[0] & 0xff) == 0x89
                && header[1] == 0x50
                && header[2] == 0x4e
                && header[3] == 0x47
                && header[4] == 0x0d
                && header[5] == 0x0a
                && header[6] == 0x1a
                && header[7] == 0x0a) return "image/png";
        if (length >= 6) {
            String signature = new String(header, 0, 6, java.nio.charset.StandardCharsets.US_ASCII);
            if ("GIF87a".equals(signature) || "GIF89a".equals(signature)) return "image/gif";
        }
        if (length >= 12
                && new String(header, 0, 4, java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF")
                && new String(header, 8, 4, java.nio.charset.StandardCharsets.US_ASCII).equals("WEBP"))
            return "image/webp";
        throw ApiException.invalid("该附件格式不支持在线预览");
    }
}

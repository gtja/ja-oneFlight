package com.oneflight.web;

import com.oneflight.auth.*;
import com.oneflight.common.*;
import com.oneflight.domain.*;
import com.oneflight.repository.AttachmentRepository;
import com.oneflight.service.*;

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
    private final Path directory;

    public AttachmentController(
            AttachmentRepository attachments,
            WorkflowService service,
            ScopeService scope,
            AuditService audit,
            @Value("${oneflight.upload-directory:./data/uploads}") String directory) {
        this.attachments = attachments;
        this.service = service;
        this.scope = scope;
        this.audit = audit;
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
        if (id == null)
            return ApiResponse.ok(
                    PageResult.of(
                            attachments.findAll().stream()
                                    .filter(x -> scope.canAccess(x.organizationId, x.region))
                                    .filter(
                                            x -> {
                                                try {
                                                    linked(x.entityType, x.entityId);
                                                    return true;
                                                } catch (ApiException e) {
                                                    return false;
                                                }
                                            })
                                    .map(Attachment::view)
                                    .toList(),
                            page,
                            pageSize));
        linked(type, id);
        return ApiResponse.ok(
                PageResult.of(
                        attachments.findByEntityId(id).stream()
                                .filter(x -> type.equals(x.entityType))
                                .map(Attachment::view)
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

    @GetMapping({"/{id}/content", "/{id}/download"})
    public ResponseEntity<org.springframework.core.io.Resource> download(@PathVariable String id) {
        Attachment a = attachments.findById(id).orElseThrow(ApiException::missing);
        linked(a.entityType, a.entityId);
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
}

package com.oneflight.integration;

import com.oneflight.common.ApiResponse;
import com.oneflight.common.PageResult;
import com.oneflight.domain.IndustryCase;
import com.oneflight.domain.Task;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/source-data/flight-photos")
public class SourceFlightPhotoController {
    private final SourceFlightPhotoService photos;

    public SourceFlightPhotoController(SourceFlightPhotoService photos) {
        this.photos = photos;
    }

    @GetMapping
    public ApiResponse<PageResult<Map<String, Object>>> list(
            @RequestParam String deviceId,
            @RequestParam Instant from,
            @RequestParam Instant to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "100") int pageSize) {
        PageResult<Map<String, Object>> result = photos.pageForDevice(deviceId, from, to, page, pageSize);
        return ApiResponse.ok(result);
    }

    @GetMapping("/tasks")
    public ApiResponse<PageResult<Map<String, Object>>> listForTask(
            @RequestParam @NotBlank @Size(max = 36) String taskId) {
        List<Map<String, Object>> result = photos.listForTask(taskId);
        return ApiResponse.ok(PageResult.of(result, 1, 100));
    }

    @GetMapping("/cases")
    public ApiResponse<PageResult<Map<String, Object>>> listForCase(
            @RequestParam @NotBlank @Size(max = 36) String caseId) {
        List<Map<String, Object>> result = photos.listForCase(caseId);
        return ApiResponse.ok(PageResult.of(result, 1, 100));
    }

    @PostMapping("/associate")
    public ApiResponse<Map<String, Object>> associate(@Valid @RequestBody AssociateRequest request) {
        Task task = photos.linkToTask(request.deviceId(), request.sourceMediaId(), request.taskId());
        return ApiResponse.ok(Map.of("taskId", task.id, "sourceMediaId", request.sourceMediaId()));
    }

    @PostMapping("/clues")
    public ApiResponse<Map<String, Object>> markAsClue(@Valid @RequestBody ClueRequest request) {
        IndustryCase created = photos.markAsClue(
                request.deviceId(), request.sourceMediaId(), request.taskId());
        return ApiResponse.ok(created.view());
    }

    @GetMapping("/preview")
    public ResponseEntity<byte[]> preview(
            @RequestParam String deviceId,
            @RequestParam String sourceMediaId,
            @RequestParam(required = false) String caseId) {
        SourceFlightPhotoService.SourceImage image = photos.preview(deviceId, sourceMediaId, caseId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(image.contentType()))
                .cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .body(image.bytes());
    }

    public record AssociateRequest(
            @NotBlank @Size(max = 180) String deviceId,
            @NotBlank @Size(max = 180) String sourceMediaId,
            @NotBlank @Size(max = 36) String taskId) {}

    public record ClueRequest(
            @NotBlank @Size(max = 180) String deviceId,
            @NotBlank @Size(max = 180) String sourceMediaId,
            @Size(max = 36) String taskId) {}
}

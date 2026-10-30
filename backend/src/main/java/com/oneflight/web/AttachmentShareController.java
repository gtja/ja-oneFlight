package com.oneflight.web;

import com.oneflight.common.ApiResponse;
import com.oneflight.service.AttachmentResourceService;
import com.oneflight.web.Requests.AttachmentShareDecisionInput;
import com.oneflight.web.Requests.AttachmentShareRequestInput;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/attachments/share-requests")
public class AttachmentShareController {
    private final AttachmentResourceService resources;

    public AttachmentShareController(AttachmentResourceService resources) {
        this.resources = resources;
    }

    @GetMapping
    public ApiResponse<?> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "100") int pageSize) {
        return ApiResponse.ok(resources.listRequests(page, pageSize));
    }

    @PostMapping
    public ApiResponse<?> request(@Valid @RequestBody AttachmentShareRequestInput input) {
        return ApiResponse.ok(resources.requestShare(input));
    }

    @PostMapping("/{id}/actions")
    public ApiResponse<?> decide(
            @PathVariable String id,
            @Valid @RequestBody AttachmentShareDecisionInput input) {
        return ApiResponse.ok(resources.decide(id, input));
    }
}

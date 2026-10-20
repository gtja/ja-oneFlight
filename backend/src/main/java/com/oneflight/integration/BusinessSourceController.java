package com.oneflight.integration;

import com.oneflight.common.ApiResponse;
import com.oneflight.common.PageResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/source-data")
public class BusinessSourceController {
    private final BusinessSourceCatalog catalog;
    private final BusinessSourceImporter importer;
    public BusinessSourceController(BusinessSourceCatalog catalog, BusinessSourceImporter importer) { this.catalog = catalog; this.importer = importer; }
    @GetMapping("/summary")
    public ApiResponse<Map<String, Object>> summary() { return ApiResponse.ok(catalog.summary()); }
    @GetMapping("/{kind}")
    public ApiResponse<PageResult<Map<String, Object>>> list(@PathVariable String kind,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize,
            @RequestParam(required=false) String keyword, @RequestParam(required=false) String eventType) {
        return ApiResponse.ok(catalog.list(kind, page, pageSize, keyword, eventType));
    }
    @PostMapping("/import")
    public ApiResponse<Map<String, Object>> importArchives(@Valid @RequestBody ImportRequest request) {
        return ApiResponse.ok(importer.importArchives(request.kinds(), request.limitPerKind() == null ? 50 : request.limitPerKind()));
    }
    public record ImportRequest(@NotEmpty @Size(max=5) Set<String> kinds, @Min(1) @Max(2000) Integer limitPerKind) { }
}

package com.oneflight.web;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.oneflight.common.ApiException;
import com.oneflight.common.ApiResponse;
import com.oneflight.service.AirspaceImportService;
import com.oneflight.web.AirspaceImportDtos.CommitResult;
import com.oneflight.web.AirspaceImportDtos.ImportOptions;
import com.oneflight.web.AirspaceImportDtos.PreviewResult;
import jakarta.validation.Validator;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

@RestController
@RequestMapping("/api/v1/resources/airspace-imports")
public class AirspaceImportController {
    private final AirspaceImportService service;
    private final Validator validator;
    private final JsonMapper optionsJson = JsonMapper.builder(JsonFactory.builder()
            .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(8).build()).build())
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS).build();
    private static final int MAX_OPTIONS_BYTES = 8 * 1024;

    public AirspaceImportController(AirspaceImportService service, Validator validator) {
        this.service = service;
        this.validator = validator;
    }

    @PostMapping(value = "/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<PreviewResult> preview(@RequestPart("file") MultipartFile file,
            @RequestPart("options") MultipartFile options) {
        return ApiResponse.ok(service.preview(file, readOptions(options)));
    }

    @PostMapping("/{batchId}/commit")
    public ApiResponse<CommitResult> commit(@PathVariable String batchId) {
        return ApiResponse.ok(service.commit(batchId));
    }

    private ImportOptions readOptions(MultipartFile options) {
        if (options.isEmpty()) throw ApiException.invalid("导入参数不能为空");
        if (options.getSize() > MAX_OPTIONS_BYTES) throw optionsTooLarge();
        try (var input = options.getInputStream()) {
            byte[] bytes = input.readNBytes(MAX_OPTIONS_BYTES + 1);
            if (bytes.length > MAX_OPTIONS_BYTES) throw optionsTooLarge();
            try (var parser = optionsJson.createParser(bytes)) {
                var tree = optionsJson.readTree(parser);
                if (tree == null || !tree.isObject() || parser.nextToken() != null)
                    throw ApiException.invalid("导入参数须为一个完整 JSON 对象");
                ImportOptions result = optionsJson.treeToValue(tree, ImportOptions.class);
                var errors = validator.validate(result);
                if (!errors.isEmpty()) throw ApiException.invalid("请选择业务组织、所属区域及 WGS84 坐标基准");
                return result;
            }
        } catch (IOException e) { throw ApiException.invalid("导入参数格式无效或嵌套过深"); }
    }

    private ApiException optionsTooLarge() {
        return new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "AIRSPACE_OPTIONS_TOO_LARGE", "导入参数不得超过8KiB");
    }
}

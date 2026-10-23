package com.oneflight.common;

import jakarta.validation.ConstraintViolationException;

import org.slf4j.*;
import org.springframework.dao.*;
import org.springframework.http.*;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger LOG = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<?> api(ApiException ex) {
        return ResponseEntity.status(ex.getStatus())
                .body(ApiResponse.error(ex.getCode(), ex.getMessage()));
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<?> auth() {
        return ResponseEntity.status(401).body(ApiResponse.error("INVALID_CREDENTIALS", "账号或密码错误"));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<?> validation(MethodArgumentNotValidException ex) {
        String message =
                ex.getBindingResult().getFieldErrors().stream()
                        .map(e -> e.getField() + ": " + e.getDefaultMessage())
                        .findFirst()
                        .orElse("参数不正确");
        return ResponseEntity.badRequest().body(ApiResponse.error("INVALID_REQUEST", message));
    }

    @ExceptionHandler({
        ConstraintViolationException.class,
        org.springframework.http.converter.HttpMessageNotReadableException.class,
        org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class
    })
    public ResponseEntity<?> invalid() {
        return ResponseEntity.badRequest().body(ApiResponse.error("INVALID_REQUEST", "参数格式不正确"));
    }

    @ExceptionHandler({
        DataIntegrityViolationException.class,
        OptimisticLockingFailureException.class
    })
    public ResponseEntity<?> conflict() {
        return ResponseEntity.status(409).body(ApiResponse.error("CONFLICT", "记录已变更或存在冲突，请刷新后重试"));
    }

    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<?> notFound() {
        return ResponseEntity.status(404).body(ApiResponse.error("NOT_FOUND", "接口不存在"));
    }

    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<?> methodNotAllowed() {
        return ResponseEntity.status(405).body(ApiResponse.error("METHOD_NOT_ALLOWED", "请求方法不支持"));
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<?> uploadTooLarge() {
        return ResponseEntity.status(413)
                .body(ApiResponse.error("FILE_TOO_LARGE", "附件大小不得超过100MB"));
    }

    @ExceptionHandler({org.springframework.web.bind.MissingServletRequestParameterException.class,
            org.springframework.web.multipart.support.MissingServletRequestPartException.class})
    public ResponseEntity<?> missingParameter() {
        return ResponseEntity.badRequest().body(ApiResponse.error("INVALID_REQUEST", "缺少必填参数"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> unknown(Exception ex) {
        LOG.error("请求处理失败", ex);
        return ResponseEntity.status(500).body(ApiResponse.error("INTERNAL_ERROR", "服务暂时不可用"));
    }
}

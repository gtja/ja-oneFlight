package com.oneflight.common;

import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public static ApiException forbidden() {
        return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "没有访问权限");
    }

    public static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message);
    }

    public static ApiException missing() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "记录不存在");
    }
}

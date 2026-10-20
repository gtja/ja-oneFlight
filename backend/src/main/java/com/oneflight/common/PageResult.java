package com.oneflight.common;

import java.util.List;

public record PageResult<T>(List<T> items, long total, int page, int pageSize) {
    public static <T> PageResult<T> of(List<T> records, int page, int pageSize) {
        if (page < 1 || page > 100000 || pageSize < 1 || pageSize > 100)
            throw ApiException.invalid("分页范围无效");
        int actualPage = page;
        int actualSize = pageSize;
        int from = Math.min(records.size(), (actualPage - 1) * actualSize);
        return new PageResult<>(
                records.subList(from, Math.min(records.size(), from + actualSize)),
                records.size(),
                actualPage,
                actualSize);
    }
}

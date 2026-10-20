package com.oneflight.repository;

import com.oneflight.domain.Resource;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ResourceRepository extends JpaRepository<Resource, String> {
    @org.springframework.data.jpa.repository.Lock(
            jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select x from Resource x where x.id = :id")
    java.util.Optional<Resource> findLockedById(
            @org.springframework.data.repository.query.Param("id") String id);
}

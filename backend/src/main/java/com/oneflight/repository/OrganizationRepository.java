package com.oneflight.repository;

import com.oneflight.domain.Organization;

import org.springframework.data.jpa.repository.JpaRepository;

public interface OrganizationRepository extends JpaRepository<Organization, String> {
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select x from Organization x where x.id = :id")
    java.util.Optional<Organization> findLockedById(
            @org.springframework.data.repository.query.Param("id") String id);
}

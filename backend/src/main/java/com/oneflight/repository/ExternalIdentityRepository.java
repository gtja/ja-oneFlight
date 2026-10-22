package com.oneflight.repository;

import com.oneflight.domain.ExternalIdentity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.Optional;

public interface ExternalIdentityRepository extends JpaRepository<ExternalIdentity, String> {
    Optional<ExternalIdentity> findByIssuerAndExternalUserId(String issuer, String externalUserId);
    Optional<ExternalIdentity> findByUserId(String userId);
    java.util.List<ExternalIdentity> findByIssuerAndExternalUserIdIn(String issuer, java.util.Collection<String> externalUserIds);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select x from ExternalIdentity x where x.issuer = :issuer and x.externalUserId = :externalUserId")
    Optional<ExternalIdentity> findLockedByIssuerAndExternalUserId(@Param("issuer") String issuer, @Param("externalUserId") String externalUserId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select x from ExternalIdentity x where x.id = :id")
    Optional<ExternalIdentity> findLockedById(@Param("id") String id);
}

package com.oneflight.repository;

import com.oneflight.domain.UserAccount;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAccountRepository extends JpaRepository<UserAccount, String> {
    java.util.Optional<UserAccount> findByUsername(String username);

    @org.springframework.data.jpa.repository.Lock(
            jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select x from UserAccount x where x.id = :id")
    java.util.Optional<UserAccount> findLockedById(
            @org.springframework.data.repository.query.Param("id") String id);
}

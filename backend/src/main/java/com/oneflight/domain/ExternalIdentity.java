package com.oneflight.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@org.hibernate.annotations.DynamicUpdate
@Table(name = "external_identity", uniqueConstraints = @UniqueConstraint(name = "uq_external_identity", columnNames = {"issuer", "external_user_id"}))
public class ExternalIdentity {
    @Id @Column(length = 36) public String id = UUID.randomUUID().toString();
    @Column(nullable = false, length = 255) public String issuer;
    @Column(nullable = false, length = 160) public String externalUserId;
    @Column(nullable = false, length = 160) public String username;
    @Column(nullable = false, length = 160) public String displayName;
    @Column(length = 160) public String externalGroupId;
    @Column(length = 160) public String externalGroupName;
    @Column(length = 160) public String externalRoleId;
    @Column(nullable = false) public boolean businessAccessAssigned;
    @Column(length = 36, unique = true) public String userId;
    @Column(nullable = false, length = 36) public String bindingRevision = UUID.randomUUID().toString();
    @Column(nullable = false) public Instant verifiedAt = Instant.now();
    @Column(nullable = false) public Instant createdAt = Instant.now();
}

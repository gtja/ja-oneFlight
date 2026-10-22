-- Preserve all existing business IDs and grants; an immutable verified identity is bound explicitly.
CREATE TABLE external_identity (
    id VARCHAR(36) PRIMARY KEY,
    issuer VARCHAR(255) NOT NULL,
    external_user_id VARCHAR(160) NOT NULL,
    username VARCHAR(160) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    user_id VARCHAR(36),
    binding_revision VARCHAR(36) NOT NULL,
    verified_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT uq_external_identity UNIQUE (issuer, external_user_id),
    CONSTRAINT uq_external_local_user UNIQUE (user_id)
);

-- Identity remains issuer + immutable user ID. These fields mirror verified 4A directory metadata.
ALTER TABLE external_identity ADD COLUMN external_group_id VARCHAR(160);
ALTER TABLE external_identity ADD COLUMN external_group_name VARCHAR(160);
ALTER TABLE external_identity ADD COLUMN external_role_id VARCHAR(160);
ALTER TABLE external_identity ADD COLUMN business_access_assigned BOOLEAN NOT NULL DEFAULT FALSE;
-- Previously explicit links already had platform business authorization.
UPDATE external_identity SET business_access_assigned = TRUE WHERE user_id IS NOT NULL;

-- Operator visibility extends to explicitly granted organizations only. Existing accounts keep their own scope.
ALTER TABLE user_account ADD COLUMN allowed_organization_ids TEXT;

-- Provenance distinguishes imported source records from locally entered initialization records.
ALTER TABLE organization ADD COLUMN provenance TEXT;
ALTER TABLE flight_task ADD COLUMN provenance TEXT;
ALTER TABLE flight_plan ADD COLUMN provenance TEXT;
ALTER TABLE platform_resource ADD COLUMN provenance TEXT;
ALTER TABLE industry_case ADD COLUMN provenance TEXT;
ALTER TABLE consultation ADD COLUMN provenance TEXT;
ALTER TABLE user_account ADD COLUMN provenance TEXT;

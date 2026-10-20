-- One physical provider resource has one local identity, preventing duplicate scheduling.
CREATE UNIQUE INDEX uq_resource_source ON platform_resource (kind, source_device_id);

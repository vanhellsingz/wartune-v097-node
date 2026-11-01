-- Additive migration. Existing characters remain published (default 0).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS creation_pending TINYINT UNSIGNED NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ultra_schema_migrations (
 version VARCHAR(64) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT IGNORE INTO ultra_schema_migrations(version) VALUES ('095_001_creation');

-- Proposed only. No automatic balance import or character update.
CREATE TABLE IF NOT EXISTS ultra_resource_ledger (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 character_id INT UNSIGNED NOT NULL,
 operation_ref VARCHAR(120) NOT NULL,
 resource_kind VARCHAR(24) NOT NULL,
 delta BIGINT NOT NULL,
 balance_before BIGINT UNSIGNED NOT NULL,
 balance_after BIGINT UNSIGNED NOT NULL,
 reason VARCHAR(120) NOT NULL,
 payload_json LONGTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_ultra_resource_operation(character_id,operation_ref),
 KEY ix_ultra_resource_character_time(character_id,created_at),
 CONSTRAINT fk_ultra_resource_character FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE RESTRICT,
 CONSTRAINT ck_ultra_resource_json CHECK(JSON_VALID(payload_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO ultra_schema_migrations(version) VALUES ('095_002_ledger_proposal');

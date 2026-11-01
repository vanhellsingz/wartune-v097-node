-- Apply only to wartune_ultra_v097test; preserves all existing data.
CREATE TABLE IF NOT EXISTS inventory_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  character_id INT UNSIGNED NOT NULL,
  template_id INT UNSIGNED NOT NULL,
  amount INT UNSIGNED NOT NULL DEFAULT 1,
  location VARCHAR(24) NOT NULL DEFAULT 'bag',
  slot_number INT UNSIGNED DEFAULT NULL,
  upgrade_level INT UNSIGNED NOT NULL DEFAULT 0,
  bound_flag TINYINT(1) NOT NULL DEFAULT 0,
  extra_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(extra_json)),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  item_name VARCHAR(128) DEFAULT NULL,
  KEY idx_inventory_character (character_id),
  CONSTRAINT fk_inventory_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- REFERENCIA HISTORICA APENAS. NAO ALTERA accounts/characters/etc.
CREATE TABLE IF NOT EXISTS legacy_catalog_meta (
 table_name VARCHAR(80) PRIMARY KEY,
 row_count INT UNSIGNED NOT NULL,
 imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 source_name VARCHAR(80) NOT NULL DEFAULT 'latestdb.db'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS legacy_catalog_rows (
 table_name VARCHAR(80) NOT NULL,
 source_seq INT UNSIGNED NOT NULL,
 data_json LONGTEXT NOT NULL,
 PRIMARY KEY (table_name,source_seq),
 CONSTRAINT fk_legacy_catalog_meta FOREIGN KEY (table_name) REFERENCES legacy_catalog_meta(table_name) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

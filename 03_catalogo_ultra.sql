-- Execute via phpMyAdmin, no banco wartune_ultra (pode executar novamente sem apagar nada).
-- Nova colecao somente de REFERENCIA; nao modifica characters, accounts ou legacy_catalog_*.
CREATE TABLE IF NOT EXISTS ultra_catalog_meta (
 table_name VARCHAR(80) NOT NULL PRIMARY KEY,
 original_file VARCHAR(190) NOT NULL,
 sha256 CHAR(64) NOT NULL,
 record_count INT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ultra_catalog_rows (
 table_name VARCHAR(80) NOT NULL,
 row_key VARCHAR(30) NOT NULL,
 source_id VARCHAR(110) NOT NULL,
 data_json LONGTEXT NOT NULL,
 PRIMARY KEY (table_name, row_key),
 KEY idx_table_source (table_name,source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

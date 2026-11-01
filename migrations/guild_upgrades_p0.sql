CREATE TABLE IF NOT EXISTS consortia_upgrades (
  consortia_id INT NOT NULL PRIMARY KEY,
  upgrade_type INT NOT NULL,
  target_level INT NOT NULL,
  offer_spent INT NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ready_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_consortia_upgrades_guild FOREIGN KEY (consortia_id) REFERENCES consortia(id) ON DELETE CASCADE
) ENGINE=InnoDB;

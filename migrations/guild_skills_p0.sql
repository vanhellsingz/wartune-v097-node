CREATE TABLE IF NOT EXISTS consortia_research (
  consortia_id INT NOT NULL,
  skill_type INT NOT NULL,
  level INT NOT NULL DEFAULT 0,
  PRIMARY KEY (consortia_id, skill_type),
  CONSTRAINT fk_consortia_research_guild FOREIGN KEY (consortia_id) REFERENCES consortia(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE consortia ADD COLUMN IF NOT EXISTS materials INT NOT NULL DEFAULT 0;
ALTER TABLE consortia_members ADD COLUMN IF NOT EXISTS build INT NOT NULL DEFAULT 0;
ALTER TABLE consortia_members ADD COLUMN IF NOT EXISTS total_build INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS consortia_skill_actions (
  character_id INT NOT NULL,
  action_type TINYINT NOT NULL,
  skill_type INT NOT NULL,
  last_at DATETIME(3) NOT NULL,
  PRIMARY KEY(character_id,action_type,skill_type)
) ENGINE=InnoDB;

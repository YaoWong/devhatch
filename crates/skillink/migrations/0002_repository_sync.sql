ALTER TABLE repositories ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX skills_repository_relative_path_unique
ON skills(repository_id, relative_path)
WHERE source_type = 'repository';

CREATE INDEX skills_repository_id_index ON skills(repository_id);
CREATE INDEX profile_skills_skill_id_index ON profile_skills(skill_id);

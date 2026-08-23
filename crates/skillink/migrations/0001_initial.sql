CREATE TABLE repositories (
    id TEXT PRIMARY KEY NOT NULL,
    url TEXT NOT NULL COLLATE NOCASE UNIQUE,
    git_ref TEXT,
    commit_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE skills (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
    description TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('custom', 'repository')),
    repository_id TEXT REFERENCES repositories(id) ON DELETE RESTRICT,
    revision TEXT,
    relative_path TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (source_type = 'custom' AND repository_id IS NULL AND revision IS NULL AND relative_path IS NULL)
        OR
        (source_type = 'repository' AND repository_id IS NOT NULL AND revision IS NOT NULL AND relative_path IS NOT NULL)
    )
);

CREATE TABLE profiles (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profile_skills (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
    PRIMARY KEY (profile_id, skill_id)
);

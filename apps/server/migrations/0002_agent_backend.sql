CREATE UNIQUE INDEX agent_launch_configs_name_nocase
ON agent_launch_configs (agent_id, name COLLATE NOCASE);

CREATE TABLE agent_launch_paths (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    path TEXT NOT NULL,
    alias TEXT,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    last_used_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (agent_id, path)
);

CREATE INDEX agent_launch_paths_order
ON agent_launch_paths (agent_id, pinned DESC, last_used_at DESC);

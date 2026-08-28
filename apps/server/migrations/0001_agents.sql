CREATE TABLE agent_launch_configs (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    pre_launch_script TEXT NOT NULL DEFAULT '',
    provider_script TEXT NOT NULL DEFAULT '',
    tui_script TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX agent_launch_configs_name_nocase
ON agent_launch_configs (agent_id, name COLLATE NOCASE);

CREATE UNIQUE INDEX agent_launch_configs_one_default_per_agent
ON agent_launch_configs (agent_id)
WHERE is_default = 1;

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

INSERT INTO agent_launch_configs (
    id,
    agent_id,
    name,
    is_default,
    pre_launch_script,
    provider_script,
    tui_script,
    created_at,
    updated_at
) VALUES
    ('opencode-default', 'opencode', 'Default', 1, '', '', '', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    ('traecli-default', 'traecli', 'Default', 1, '', '', '', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    ('pi-default', 'pi', 'Default', 1, '', '', '', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    ('codex-default', 'codex', 'Default', 1, '', '', '', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER));

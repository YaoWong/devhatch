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
    path TEXT NOT NULL UNIQUE,
    alias TEXT,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    last_used_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX agent_launch_paths_order
ON agent_launch_paths (pinned DESC, last_used_at DESC, path COLLATE NOCASE);

CREATE TABLE agent_workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    active_agent_session_id TEXT CHECK (active_agent_session_id <> ''),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE agent_workspace_members (
    agent_session_id TEXT PRIMARY KEY NOT NULL CHECK (agent_session_id <> ''),
    workspace_id TEXT NOT NULL REFERENCES agent_workspaces (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (workspace_id, position)
);

CREATE INDEX agent_workspace_members_workspace
ON agent_workspace_members (workspace_id, position);

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

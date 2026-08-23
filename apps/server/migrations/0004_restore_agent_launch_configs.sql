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
) VALUES (
    'opencode-default',
    'opencode',
    'Default',
    1,
    '',
    '',
    '',
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    CAST(unixepoch('subsec') * 1000 AS INTEGER)
);

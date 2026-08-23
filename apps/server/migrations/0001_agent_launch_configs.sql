CREATE TABLE agent_launch_configs (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    launch_mode TEXT NOT NULL CHECK (launch_mode IN ('default', 'work', 'superwork', 'omo')),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (agent_id, name)
);

CREATE UNIQUE INDEX agent_launch_configs_one_default_per_agent
ON agent_launch_configs (agent_id)
WHERE is_default = 1;

INSERT OR IGNORE INTO agent_launch_configs (
    id,
    agent_id,
    name,
    launch_mode,
    is_default,
    created_at,
    updated_at
) VALUES (
    'opencode-default',
    'opencode',
    'Default',
    'default',
    1,
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    CAST(unixepoch('subsec') * 1000 AS INTEGER)
);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    active_session_kind TEXT CHECK (active_session_kind IN ('terminal', 'agent')),
    active_session_id TEXT CHECK (active_session_id <> ''),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (
        (active_session_kind IS NULL AND active_session_id IS NULL)
        OR (active_session_kind IS NOT NULL AND active_session_id IS NOT NULL)
    )
);

CREATE TABLE workspace_members (
    session_kind TEXT NOT NULL CHECK (session_kind IN ('terminal', 'agent')),
    session_id TEXT NOT NULL CHECK (session_id <> ''),
    workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (session_kind, session_id),
    UNIQUE (workspace_id, position)
);

CREATE INDEX workspace_members_workspace
ON workspace_members (workspace_id, position);

CREATE TABLE launch_paths (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    alias TEXT,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    last_used_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX launch_paths_order
ON launch_paths (pinned DESC, last_used_at DESC, path COLLATE NOCASE);

INSERT INTO workspaces (
    id,
    name,
    active_session_kind,
    active_session_id,
    created_at,
    updated_at
)
SELECT
    'terminal:' || id,
    name,
    CASE WHEN active_terminal_id IS NULL THEN NULL ELSE 'terminal' END,
    active_terminal_id,
    created_at,
    updated_at
FROM terminal_workspaces
ORDER BY id;

INSERT INTO workspace_members (
    session_kind,
    session_id,
    workspace_id,
    position
)
SELECT
    'terminal',
    terminal_id,
    'terminal:' || workspace_id,
    position
FROM terminal_workspace_members
ORDER BY workspace_id, position, terminal_id;

INSERT INTO workspaces (
    id,
    name,
    active_session_kind,
    active_session_id,
    created_at,
    updated_at
)
SELECT
    'agent:' || id,
    name,
    CASE WHEN active_agent_session_id IS NULL THEN NULL ELSE 'agent' END,
    active_agent_session_id,
    created_at,
    updated_at
FROM agent_workspaces
ORDER BY id;

INSERT INTO workspace_members (
    session_kind,
    session_id,
    workspace_id,
    position
)
SELECT
    'agent',
    agent_session_id,
    'agent:' || workspace_id,
    position
FROM agent_workspace_members
ORDER BY workspace_id, position, agent_session_id;

INSERT INTO launch_paths (
    id,
    path,
    alias,
    pinned,
    last_used_at,
    created_at,
    updated_at
)
SELECT
    'terminal:' || terminal.id,
    terminal.path,
    CASE
        WHEN NULLIF(TRIM(terminal.alias), '') IS NOT NULL THEN terminal.alias
        ELSE agent.alias
    END,
    MAX(terminal.pinned, COALESCE(agent.pinned, 0)),
    MAX(terminal.last_used_at, COALESCE(agent.last_used_at, terminal.last_used_at)),
    MIN(terminal.created_at, COALESCE(agent.created_at, terminal.created_at)),
    MAX(terminal.updated_at, COALESCE(agent.updated_at, terminal.updated_at))
FROM terminal_launch_paths AS terminal
LEFT JOIN agent_launch_paths AS agent ON agent.path = terminal.path
ORDER BY terminal.id;

INSERT INTO launch_paths (
    id,
    path,
    alias,
    pinned,
    last_used_at,
    created_at,
    updated_at
)
SELECT
    'agent:' || agent.id,
    agent.path,
    agent.alias,
    agent.pinned,
    agent.last_used_at,
    agent.created_at,
    agent.updated_at
FROM agent_launch_paths AS agent
WHERE NOT EXISTS (
    SELECT 1
    FROM terminal_launch_paths AS terminal
    WHERE terminal.path = agent.path
)
ORDER BY agent.id;

ALTER TABLE app_settings
RENAME COLUMN agent_launch_paths_max_height_px TO launch_paths_max_height_px;

DROP TABLE terminal_workspace_members;
DROP TABLE terminal_workspaces;
DROP TABLE agent_workspace_members;
DROP TABLE agent_workspaces;
DROP TABLE terminal_launch_paths;
DROP TABLE agent_launch_paths;

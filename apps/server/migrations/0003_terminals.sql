CREATE TABLE terminal_launch_paths (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    alias TEXT,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    last_used_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX terminal_launch_paths_sort
ON terminal_launch_paths (pinned DESC, last_used_at DESC, path COLLATE NOCASE);

CREATE TABLE terminal_workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    active_terminal_id TEXT NOT NULL CHECK (active_terminal_id <> ''),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE terminal_workspace_members (
    terminal_id TEXT PRIMARY KEY NOT NULL CHECK (terminal_id <> ''),
    workspace_id TEXT NOT NULL REFERENCES terminal_workspaces (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (workspace_id, position)
);

CREATE INDEX terminal_workspace_members_workspace
ON terminal_workspace_members (workspace_id, position);

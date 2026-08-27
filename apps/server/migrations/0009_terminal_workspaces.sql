CREATE TABLE terminal_workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    last_used_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX terminal_workspaces_sort
ON terminal_workspaces (pinned DESC, last_used_at DESC, path COLLATE NOCASE);

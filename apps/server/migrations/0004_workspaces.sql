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
    ),
    FOREIGN KEY (id, active_session_kind, active_session_id)
        REFERENCES workspace_sessions (workspace_id, session_kind, session_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE workspace_sessions (
    session_kind TEXT NOT NULL CHECK (session_kind IN ('terminal', 'agent')),
    session_id TEXT NOT NULL CHECK (session_id <> ''),
    workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (session_kind, session_id),
    UNIQUE (workspace_id, position),
    UNIQUE (workspace_id, session_kind, session_id)
);

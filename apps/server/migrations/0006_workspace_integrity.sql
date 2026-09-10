CREATE TABLE workspaces_next (
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
        REFERENCES workspace_sessions_next (workspace_id, session_kind, session_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE workspace_sessions_next (
    session_kind TEXT NOT NULL CHECK (session_kind IN ('terminal', 'agent')),
    session_id TEXT NOT NULL CHECK (session_id <> ''),
    workspace_id TEXT NOT NULL REFERENCES workspaces_next (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (session_kind, session_id),
    UNIQUE (workspace_id, position),
    UNIQUE (workspace_id, session_kind, session_id)
);

INSERT INTO workspaces_next (
    id,
    name,
    active_session_kind,
    active_session_id,
    created_at,
    updated_at
)
SELECT
    workspace.id,
    workspace.name,
    NULL,
    NULL,
    workspace.created_at,
    workspace.updated_at
FROM workspaces AS workspace
ORDER BY workspace.created_at, workspace.id;

INSERT INTO workspace_sessions_next (
    session_kind,
    session_id,
    workspace_id,
    position
)
SELECT
    member.session_kind,
    member.session_id,
    member.workspace_id,
    member.position
FROM workspace_members AS member
JOIN workspaces AS workspace ON workspace.id = member.workspace_id
ORDER BY member.workspace_id, member.position, member.session_kind, member.session_id;

UPDATE workspaces_next
SET
    active_session_kind = CASE
        WHEN (
            SELECT workspace.active_session_kind
            FROM workspaces AS workspace
            WHERE workspace.id = workspaces_next.id
        ) IS NULL THEN NULL
        ELSE COALESCE(
            (
                SELECT active.session_kind
                FROM workspace_sessions_next AS active
                WHERE active.workspace_id = workspaces_next.id
                  AND active.session_kind = (
                      SELECT workspace.active_session_kind
                      FROM workspaces AS workspace
                      WHERE workspace.id = workspaces_next.id
                  )
                  AND active.session_id = (
                      SELECT workspace.active_session_id
                      FROM workspaces AS workspace
                      WHERE workspace.id = workspaces_next.id
                  )
            ),
            (
                SELECT fallback.session_kind
                FROM workspace_sessions_next AS fallback
                WHERE fallback.workspace_id = workspaces_next.id
                ORDER BY fallback.position, fallback.session_kind, fallback.session_id
                LIMIT 1
            )
        )
    END,
    active_session_id = CASE
        WHEN (
            SELECT workspace.active_session_id
            FROM workspaces AS workspace
            WHERE workspace.id = workspaces_next.id
        ) IS NULL THEN NULL
        ELSE COALESCE(
            (
                SELECT active.session_id
                FROM workspace_sessions_next AS active
                WHERE active.workspace_id = workspaces_next.id
                  AND active.session_kind = (
                      SELECT workspace.active_session_kind
                      FROM workspaces AS workspace
                      WHERE workspace.id = workspaces_next.id
                  )
                  AND active.session_id = (
                      SELECT workspace.active_session_id
                      FROM workspaces AS workspace
                      WHERE workspace.id = workspaces_next.id
                  )
            ),
            (
                SELECT fallback.session_id
                FROM workspace_sessions_next AS fallback
                WHERE fallback.workspace_id = workspaces_next.id
                ORDER BY fallback.position, fallback.session_kind, fallback.session_id
                LIMIT 1
            )
        )
    END;

DROP TABLE workspace_members;
DROP TABLE workspaces;

ALTER TABLE workspaces_next RENAME TO workspaces;
ALTER TABLE workspace_sessions_next RENAME TO workspace_sessions;

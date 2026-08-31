CREATE TABLE admin_credentials (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE INDEX auth_sessions_expires_at ON auth_sessions (expires_at);

CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    theme TEXT NOT NULL CHECK (theme IN ('default', 'latte', 'frappe', 'macchiato', 'mocha')),
    agent_launch_paths_max_height_px INTEGER NOT NULL DEFAULT 286 CHECK (agent_launch_paths_max_height_px BETWEEN 160 AND 480),
    navigation_rail_width_px INTEGER NOT NULL DEFAULT 288 CHECK (navigation_rail_width_px BETWEEN 240 AND 480),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO app_settings (
    id,
    theme,
    agent_launch_paths_max_height_px,
    navigation_rail_width_px,
    created_at,
    updated_at
) VALUES (
    1,
    'default',
    286,
    288,
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    CAST(unixepoch('subsec') * 1000 AS INTEGER)
);

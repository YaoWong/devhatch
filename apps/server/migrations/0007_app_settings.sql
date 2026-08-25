CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    theme TEXT NOT NULL CHECK (theme IN ('default', 'latte', 'frappe', 'macchiato', 'mocha')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO app_settings (id, theme, created_at, updated_at)
VALUES (
    1,
    'default',
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    CAST(unixepoch('subsec') * 1000 AS INTEGER)
);

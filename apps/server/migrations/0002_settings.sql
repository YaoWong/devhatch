CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    theme TEXT NOT NULL CHECK (theme IN ('default', 'latte', 'frappe', 'macchiato', 'mocha')),
    launch_paths_max_height_px INTEGER NOT NULL DEFAULT 286 CHECK (launch_paths_max_height_px BETWEEN 160 AND 480),
    workspace_max_height_px INTEGER NOT NULL DEFAULT 286 CHECK (workspace_max_height_px BETWEEN 160 AND 480),
    navigation_rail_width_px INTEGER NOT NULL DEFAULT 288 CHECK (navigation_rail_width_px BETWEEN 240 AND 480),
    font_size_px INTEGER NOT NULL DEFAULT 13 CHECK (font_size_px BETWEEN 12 AND 20),
    ui_scale_percent INTEGER NOT NULL DEFAULT 100 CHECK (ui_scale_percent BETWEEN 80 AND 125 AND ui_scale_percent % 5 = 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO app_settings (
    id,
    theme,
    launch_paths_max_height_px,
    workspace_max_height_px,
    navigation_rail_width_px,
    font_size_px,
    ui_scale_percent,
    created_at,
    updated_at
) VALUES (
    1,
    'default',
    286,
    286,
    288,
    13,
    100,
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    CAST(unixepoch('subsec') * 1000 AS INTEGER)
);

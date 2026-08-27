ALTER TABLE app_settings
ADD COLUMN agent_launch_paths_max_height_px INTEGER NOT NULL DEFAULT 286
CHECK (agent_launch_paths_max_height_px BETWEEN 160 AND 480);

ALTER TABLE app_settings
ADD COLUMN navigation_rail_width_px INTEGER NOT NULL DEFAULT 288
CHECK (navigation_rail_width_px BETWEEN 240 AND 480);

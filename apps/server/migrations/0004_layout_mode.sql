ALTER TABLE app_settings
ADD COLUMN layout_mode TEXT NOT NULL DEFAULT 'canvas' CHECK (layout_mode IN ('classic', 'canvas'));

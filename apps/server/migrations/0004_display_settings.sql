ALTER TABLE app_settings
ADD COLUMN font_size_px INTEGER NOT NULL DEFAULT 13 CHECK (font_size_px BETWEEN 12 AND 20);

ALTER TABLE app_settings
ADD COLUMN ui_scale_percent INTEGER NOT NULL DEFAULT 100 CHECK (ui_scale_percent BETWEEN 80 AND 125 AND ui_scale_percent % 5 = 0);

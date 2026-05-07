-- Add per-agent markdown editor height preferences.
ALTER TABLE profiles
  ADD COLUMN editor_min_height_px INTEGER NOT NULL DEFAULT 300
    CHECK (editor_min_height_px BETWEEN 120 AND 1000),
  ADD COLUMN editor_max_height_px INTEGER NOT NULL DEFAULT 540
    CHECK (editor_max_height_px BETWEEN 200 AND 2000),
  ADD CONSTRAINT editor_height_min_le_max
    CHECK (editor_min_height_px <= editor_max_height_px);

-- Add editor view mode preference to profiles
ALTER TABLE profiles
  ADD COLUMN editor_view_mode TEXT NOT NULL DEFAULT 'both'
  CHECK (editor_view_mode IN ('both', 'preview', 'editor'));

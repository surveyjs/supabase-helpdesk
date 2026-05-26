-- ============================================================
-- Migration 031 — Persist active dashboard view per agent
-- ============================================================
-- Stores the last-selected saved view for each agent so navigation
-- away from /agent (e.g. opening a ticket) does not reset the view
-- to Default on return.

ALTER TABLE profiles
  ADD COLUMN active_view_id UUID REFERENCES saved_views(id) ON DELETE SET NULL;

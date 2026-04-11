-- ==========================================================
-- Phase 8 — File Attachments
-- ==========================================================

-- Attachments table
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL CHECK (char_length(original_filename) <= 255),
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_post_id ON attachments (post_id);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Attachments inherit post visibility via RLS
-- Users who can see the post can see its attachments
CREATE POLICY attachments_select ON attachments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = attachments.post_id
    )
  );

-- Post author or agent can insert attachments
CREATE POLICY attachments_insert ON attachments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = attachments.post_id
      AND (p.author_id = auth.uid() OR is_agent())
    )
  );

-- Author or agent can delete
CREATE POLICY attachments_delete ON attachments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = attachments.post_id
      AND (p.author_id = auth.uid() OR is_agent())
    )
  );

-- Storage policies for the attachments bucket
-- Authenticated users can upload to the attachments bucket
CREATE POLICY storage_attachments_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'attachments' AND auth.uid() IS NOT NULL
  );

-- Authenticated users can read (for signed URLs)
CREATE POLICY storage_attachments_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'attachments' AND auth.uid() IS NOT NULL
  );

-- Only owner or agent can update storage objects
CREATE POLICY storage_attachments_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'attachments'
    AND (owner_id = auth.uid()::text OR is_agent())
  );

-- Only owner or agent can delete storage objects
CREATE POLICY storage_attachments_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'attachments'
    AND (owner_id = auth.uid()::text OR is_agent())
  );

-- File upload settings in app_settings
INSERT INTO app_settings (key, value) VALUES
  ('allowed_file_types', '["png","jpg","jpeg","gif","webp","svg","pdf","doc","docx","xls","xlsx","txt","csv","md","zip","rar","7z","tar.gz"]'),
  ('max_file_size_mb', '10'),
  ('max_files_per_post', '5')
ON CONFLICT (key) DO NOTHING;

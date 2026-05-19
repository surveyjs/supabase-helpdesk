-- ============================================================
-- Phase 28 — Migrated Attachment Support
-- ============================================================
-- Attachments imported from the legacy AnswerDesk system are
-- stored flat in the `attachments` Storage bucket under the
-- path `migrated/{legacy_blob_id}` and carry a NULL
-- storage_path. User-uploaded attachments keep the existing
-- nested path (storage_path IS NOT NULL, legacy_blob_id IS
-- NULL). Either field must be set; both may not be NULL.
--
-- Migrated files are effectively read-only: the Server Actions
-- cannot overwrite them in-place. To replace a migrated file
-- the user deletes the attachment row and re-uploads, which
-- creates a new row with storage_path following the standard
-- path convention.
--
-- The bucket-level file_size_limit is removed here because the
-- migration script must upload files larger than 10 MB. The
-- 10 MB cap for user-initiated uploads is enforced by the
-- uploadAttachments / uploadInlineAttachment Server Actions via
-- app_settings.max_file_size_mb. Migrated files (legacy_blob_id
-- IS NOT NULL) are exempt from that check by design.
-- ============================================================

ALTER TABLE attachments
  ADD COLUMN legacy_blob_id UUID,
  ALTER COLUMN storage_path DROP NOT NULL,
  ADD CONSTRAINT attachments_has_path CHECK (
    storage_path IS NOT NULL OR legacy_blob_id IS NOT NULL
  );

-- Remove bucket-level size cap; Server Actions enforce the limit for new uploads.
UPDATE storage.buckets
SET file_size_limit = NULL
WHERE id = 'attachments';

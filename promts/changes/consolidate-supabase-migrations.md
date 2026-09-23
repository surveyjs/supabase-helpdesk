# Change: Consolidate Supabase Migrations into a Single Initial Schema

## Summary

The project is not in production yet, but `supabase/migrations/` has grown to a
long chain of incremental files (`001_core_schema.sql` … `034_restrict_ai_vault_rpcs.sql`).
Many of them only exist to patch what an earlier file created: `ALTER TABLE … ADD COLUMN`,
`DROP POLICY` + `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, `DROP VIEW` + `CREATE VIEW`,
`DELETE`/`UPDATE` fixes to seed rows, and `ON CONFLICT DO NOTHING` guards.

Replace the whole chain with **one** migration,
`supabase/migrations/001_initial_schema.sql`, that creates the database directly in
its **final** state, with no create-then-modify steps. The resulting database must be
functionally identical to the one produced by the old chain, and you must prove it
with a schema/data diff (see **Verification**).

## Prerequisites (already in place)

| What | Where |
|---|---|
| Incremental migrations to fold in | `supabase/migrations/*.sql` (at `HEAD`) |
| Local Supabase stack (Docker) | container `supabase_db_helpdesk` |
| Seed data (runs after migrations on `db reset`) | `supabase/seed.sql` (leave unchanged) |
| Storage bucket config | `supabase/config.toml` → `[storage.buckets.attachments]` |

## Changes

### 1. Read every migration and derive the final state

Read **all** files in order before writing anything. For each object, keep only its
last definition:

- **Tables:** columns added later by `ALTER TABLE … ADD COLUMN` go into the
  `CREATE TABLE`. Apply every `ALTER COLUMN … DROP NOT NULL` and every replaced
  `CHECK` directly.
- **Indexes:** keep the final form only. For example, `idx_tickets_slug` starts
  `UNIQUE` in 001 and is dropped and recreated as non-unique in 003.
- **Functions:** use the last `CREATE OR REPLACE` body. `handle_new_user`,
  `check_ticket_rate_limit` and `update_ticket_search_vector` are all redefined later.
- **Policies:** use the last `DROP POLICY` / `CREATE POLICY` pair. Watch `profiles_update`
  (001 → 008 → 018), `ticket_tags_select` (008), `ticket_tags_insert` and `ticket_tags_delete`
  (018), and `attachments_*` (023 / 024).
- **Views:** create `agent_tickets` once, in its final form with the tier columns.
- **Grants:** put each `REVOKE`/`GRANT` right after the function it applies to. For
  example, 034 locks down the AI Vault RPCs from 017.
- **Seed rows:**
  - Drop rows that a later migration deletes (the `survey_*_config` keys from 022,
    removed in 025 and 026).
  - Apply later `UPDATE`s directly to the inserted values: the `/redirect` ticket URLs
    from 032 and `"autoGenerateCustomFields":true` from 029.
  - Where several migrations insert the same key with `ON CONFLICT DO NOTHING`, the
    **first** insert wins. For example, `merge_banner` keeps the 005 wording, not 015's.
  - Remove the `ON CONFLICT` guards, since this is a fresh database.
- **Storage bucket:** create it once, in its final form, with
  `file_size_limit = NULL` (023 creates it, 028 removes the limit). Use
  `ON CONFLICT (id) DO UPDATE SET file_size_limit = NULL` in case the bucket already exists.

### 2. Preserve names the application depends on

The app embeds PostgREST relationships by FK name, e.g.
`profiles!kb_articles_author_id_fkey` and `profiles!tickets_creator_id_fkey`.
Tests also check `chk_display_name_not_reserved` and `editor_height_min_le_max`.

- Keep every constraint, index, policy, trigger and function name unchanged.
- Inline `REFERENCES` / `CHECK` produce the same auto-generated names that
  `ALTER TABLE … ADD` produced (`<table>_<column>_fkey`, `<table>_<column>_check`).
- Keep named table constraints (`CONSTRAINT chk_…`) named.

### 3. Handle circular references (the only allowed `ALTER`s)

Three FKs form cycles and cannot be declared inline. Declare each column without an FK,
then add the constraint **with its default name** once the target table exists:

| Column | References | Constraint name |
|---|---|---|
| `profiles.active_view_id` | `saved_views(id) ON DELETE SET NULL` | `profiles_active_view_id_fkey` |
| `tickets.cloned_from_post_id` | `posts(id) ON DELETE SET NULL` | `tickets_cloned_from_post_id_fkey` |
| `tickets.source_article_id` | `kb_articles(id) ON DELETE SET NULL` | `tickets_source_article_id_fkey` |

Also create `subscription_tiers` **before** `profiles`, because `profiles.tier_id`
references it.

### 4. Ordering rules

- Create tables before the `LANGUAGE sql` helper functions, because SQL function
  bodies are validated at creation time (e.g. `get_user_role()` reads `profiles`).
- Create helper functions (`is_agent`, `is_admin`, `is_teammate`, `is_blocked`,
  `user_has_tier_capability`, `get_root_post_is_private`) before any policy uses them.
- Seed data can go in one section near the end: ticket types, `sla_severity_mapping`,
  the single `email_config` row, `app_settings` and `notification_templates`.
- Group all `pg_cron` jobs in one guarded `DO $$ … IF EXISTS (pg_extension 'pg_cron') … $$`
  block at the end.

Suggested layout, with numbered section headers listed at the top of the file:
extensions and enums → core tables → helper functions → core triggers → core RLS →
`agent_tickets` view → then one section per feature (admin, attachments and storage,
email notifications, in-app notifications and realtime, CSAT, SLA, knowledge base,
user notes, canned responses, inbound email, AI) → Vault RPCs → seed data → scheduled jobs.

Keep the explanatory comments that still matter, such as the CSAT "no DB-side dispatch"
note, the three kinds of attachment rows, and the SurveyJS template wrapper contract.
Drop history-only comments ("replaces migration 022", "Phase 17", …).

### 5. Remove the old files and update references

- `git rm` every old file in `supabase/migrations/` so that only `001_initial_schema.sql` remains.
- In `README.md`, update the `migrations/` line in the project tree.
- Leave the historical build prompts in `promts/` unchanged.

## Verification

Prove equivalence without touching the developer's local database. Build two
throwaway databases from the same image as the local stack, then diff them.

```bash
IMG=$(docker inspect supabase_db_helpdesk --format '{{.Config.Image}}')
for n in old new; do docker run -d --rm --name mig_cmp_$n -e POSTGRES_PASSWORD=postgres $IMG; done
# wait for pg_isready in both containers
```

1. **Add the `storage` schema.** The bare image has `auth`, `vault` and the
   `supabase_realtime` publication but no `storage` schema, because storage-api
   creates that. Copy it, schema only, from the running local stack:
   ```bash
   docker exec supabase_db_helpdesk pg_dump -U supabase_admin -d postgres -n storage \
     --schema-only --no-owner --no-privileges > storage_schema.sql
   sed -i 's/^CREATE SCHEMA storage;/CREATE SCHEMA IF NOT EXISTS storage;/' storage_schema.sql
   ```
   Load it into both containers as `supabase_admin`. The dump also contains the
   app's own `storage_attachments_*` policies, which fail because `is_agent()`
   doesn't exist yet. After loading, make sure no policies remain on `storage.*`,
   so the migrations create them. Then run
   `GRANT USAGE ON SCHEMA storage …` and `GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres, service_role, anon, authenticated`.
   Without these grants, the bucket insert fails with "permission denied for table buckets".
2. **Apply the migrations** as the `postgres` role with `-v ON_ERROR_STOP=1 --single-transaction`:
   - `mig_cmp_old`: each old file from `git show HEAD:<file>`, in order
   - `mig_cmp_new`: `001_initial_schema.sql`
3. **Diff the results:**
   - `pg_dump -n public --schema-only --no-owner` from both containers (ignore `\restrict` token lines)
   - `pg_policies WHERE schemaname='storage'`, `storage.buckets`, `pg_publication_tables`,
     and `proacl` of public functions
   - all rows of `app_settings`, `notification_templates`, `ticket_types`,
     `sla_severity_mapping`, and the `email_config` row count
4. **Remove the containers:** `docker rm -f mig_cmp_old mig_cmp_new`.

**Expected, acceptable differences:**

- **Column order:** formerly `ALTER`-added columns now sit inside the table definition
  (`profiles`, `tickets`, `attachments`, `kb_articles`).
- **`agent_tickets` view:** it now also exposes `tickets.cloned_from_id` and
  `cloned_from_post_id`. The old view expanded `t.*` before migration 033 added them.
- **Ticket-detail template settings:** these differ only in formatting. The old
  migration 029 round-tripped them through `jsonb`, which reordered keys. The JSON is
  semantically equal.

**Any other difference is a bug in the consolidated file.**

## Rollout Notes

- Developers must run `supabase db reset` locally. This wipes local data. The existing
  migration history lists versions 001–034, and the new `001` reuses that version, so
  it won't be re-applied on its own.
- Hosted dev or staging projects must be reset, or have their history repaired with
  `supabase migration repair`, before the next `supabase db push`.
- **Optional follow-ups, not part of this change:**
  - Backward-compatibility fallbacks for "older DBs without migration 021/027" are now
    dead code: `src/app/(main)/tickets/[id]/[slug]/page.tsx`,
    `src/app/(main)/tickets/new/page.tsx` and `src/lib/actions/profile.ts`.
  - `supabase/config.toml` still sets `file_size_limit = "10MiB"` on the attachments
    bucket, which contradicts the schema's intentional `NULL` limit.

## Acceptance Criteria

1. `supabase/migrations/` contains only `001_initial_schema.sql`.
2. The file contains no `DROP`, no `CREATE OR REPLACE` of an object it already
   created, no `UPDATE`/`DELETE` of its own seed rows, no `ON CONFLICT` on seed
   inserts other than the storage bucket, and no `ALTER TABLE` other than enabling RLS
   and the three circular FKs.
3. The verification diff shows only the expected differences listed above.
4. `supabase db reset` succeeds and `supabase/seed.sql` loads on top of it.
5. `npm run typecheck`, `npm run lint` and `npm run test` (unit + db + e2e) pass after the reset.

# AnswerDesk import

Imports the legacy AnswerDesk export package (`HANDOFF.md`, `MAPPING.md`, CSVs, blobs) into a
HelpDesk instance, fully or as a deterministic sample of tickets. It is written for a **local
deploy-bundle instance** (bundled Supabase, DB container `supabase-db`, API gateway on
`127.0.0.1:8000`).

> The package and the staging dir hold real customer data. Keep both outside the repo and on
> encrypted storage. The scripts print counts only. Don't paste staging files or DB rows into
> tickets, chats or LLM tools.

## Pipeline

| Step | Command | What it does |
|---|---|---|
| prepare | `import.sh prepare` | Parses the `\|@\|` CSVs, samples tickets, transforms rows, and writes `$WORK/*.tsv` plus `report.txt`. Takes seconds. |
| upload | `import.sh upload` | Uploads the blobs of the sampled attachments to Storage `attachments/migrated/<FileItems.Id>`. Resumable through `$WORK/uploaded.txt`. Runs at about 8 MB/s locally. |
| load | `import.sh load` | Copies the TSVs into the DB container, then runs `load.sql` in one transaction. Removes the copies afterwards. |
| test-relink | `import.sh test-relink` | Self-test of `relink.sql` (`relink.test.sql`) on synthetic data in a transaction that is rolled back. Defaults to the local test stack container `supabase_db_helpdesk` (ignores the `supabase-db` default), refuses any `supabase-*` container with exit 2 (no override), and refuses to run if an `adimport` schema already exists. |
| relink | `import.sh relink` | Re-runs only the cross-ticket reference rewrite (`relink.sql`) on an already loaded instance. Needs `$WORK/ticket_friendly.tsv` from `prepare`. `load` runs it too. |
| status | `import.sh status` | Prints the summary of the last load. |
| reset | `import.sh reset` | Deletes the imported tickets and the accounts the import created. Dev only. |

Run `upload` before `load`. `load` only inserts attachment rows whose blob is already in Storage.

```bash
# from the repo root, in Git Bash
export PKG=/path/to/answerdesk-migration     # export package (required)
export WORK=$PKG/work                        # staging (customer data); this is the default
export DEPLOY=/path/to/deploy-bundle         # deploy bundle dir, its .env has SERVICE_ROLE_KEY (required)
export FRACTION=0.1                           # ~10% of tickets
export ADMIN_EMAIL=...                        # source user who becomes admin (HANDOFF §5, Q3)

scripts/answerdesk/import.sh prepare
cat "$WORK/report.txt"
scripts/answerdesk/import.sh upload
scripts/answerdesk/import.sh load
```

`prepare` skips automated DMARC aggregate-report e-mails (subject `[Preview] Report Domain: …
Submitter: … Report-ID: …`) that AnswerDesk turned into tickets. To import them anyway, run
`prepare.mjs` with `--keep-automated`, or set `KEEP_AUTOMATED=1` for `import.sh prepare`/`all`. `report.txt` also lists the value distributions of
`TicketStatus`, `Severity`, `Urgent`, assignee present and `IsPrivate` for the sampled tickets.

**Growing the sample.** A ticket is in the sample when `md5(ticket id) < FRACTION`, so the
0.1 sample is contained in the 0.3 sample. Re-run all three steps with a larger `FRACTION`. Only the
new tickets, posts and blobs are added. The id maps in the `adimport` schema make every step
idempotent.

## How the data maps

- **Users.** All ~7.5k users are created with their source UUIDs and no password. The `email` is
  marked confirmed. Each user gets an `email` identity, and each `ExternalLogin` row becomes a
  `custom:external` identity with `provider_id` = the auth.surveyjs.io subject. A user's first SSO
  sign-in therefore lands in the imported account. A source user is **linked instead of created**
  when an account already exists with the same id, the same SSO subject or the same email.
  `UserInRole`/`IsEmployee` users become `agent` and `ADMIN_EMAIL` becomes `admin`. Roles are only
  ever raised, never lowered. `IsDisabled` users become blocked.
- **Tickets.** New `BIGSERIAL` ids are allocated in creation order. Status comes from
  `TicketStatus` (Active → open, Closed → closed). `Urgent` → urgency high. Severity maps
  Severe/Moderate/Minor → critical/medium/low. `Category`, `Assignee`, `Duplicate` and
  `ClonedFrom` are mapped where the target ticket is also imported. `LicenseStatus` and
  `TF100002` become the custom fields "License Status" (dropdown) and "Is License Owner"
  (checkbox). `updated_at` is the latest of Modified/Updated/last post.
- **Posts.** AnswerDesk bodies are already **Markdown** (code fences, `[x](y)` links), so they are
  kept verbatim and **not** run through turndown. Types map as follows:

  | Source | Target |
  |---|---|
  | 0 = question | original `post` |
  | 1 = answer | top-level `post` |
  | 2 = comment | `comment` |
  | 3 = staff comment | `comment` |

  A comment's `parent_post_id` is its top-level ancestor. Chains deeper than two levels are
  flattened, with `parent_comment_id` set to the level-1 comment. `IsPrivate` becomes `is_private`:
  visible to the author, the ticket creator and agents. That matches AnswerDesk, so no post
  becomes an internal `note`.
- **Inline attachments.** `({'Id':'<FileItems.Id>','CheckAnswerDesk':…})` and `/attachment/file/<id>`
  links are rewritten to `/attachments/<attachment id>`. That is the URL form the editor itself
  stores, and the app resolves it to a signed URL. References to files that weren't migrated
  become plain text marked *(attachment not migrated)*.
- **Ticket references.** AnswerDesk links another ticket with a marker
  `{'FriendlyId':'T4502','HashCode':'','CheckAnswerDesk':'<guid>'}`. The marker can be a link target,
  link text, a reference definition, or bare text. Some posts link to
  `https://<host>.answerdesk.io/ticket/details/t4502/<slug>` instead. The `CheckAnswerDesk` GUID
  isn't the ticket id. `prepare` writes `ticket_friendly.tsv` (FriendlyId number → `Tickets.Id`, for
  all source tickets), and `relink.sql` (run by `load` and `relink`) rewrites references in posts of
  imported tickets:
  - When the referenced ticket is imported, the reference becomes a link to `/tickets/<id>/<slug>`.
  - When it isn't, the marker becomes plain text like `T4502 (legacy ticket)`, and an answerdesk.io
    URL stays as it is. Other answerdesk.io URLs are never changed.

  A second run changes nothing. **Caveat:** a reference that became "legacy ticket" text isn't
  re-linked if a later, larger sample imports that ticket. For exact links, `reset` and reload with
  the final `FRACTION`.

  A FriendlyId shared by several source tickets maps to the one with the lowest `Tickets.Id`;
  `report.txt` counts such duplicates. **Rare shapes:** rules e and h turn a bare marker or URL
  into a markdown link wherever it stands, so one inside link text (`[see https://…/t4502](/x)`)
  becomes a nested link, and one inside an HTML attribute (`<a href="https://…/t4502">`) puts
  markdown into the `href` and breaks it. Check `relink` output on such posts by hand.
- **Attachments.** Each target row keeps the source `Attachments.Id`, with
  `legacy_blob_id = FileItems.Id` and `storage_path = NULL`. The importer skips infected files
  (`ScanStatus = 1`), blobs missing on disk, and files over 50 MB (the Storage `FILE_SIZE_LIMIT`).
- **Also imported:** ticket tags, followers (`Favorites`, minus the owner), the latest CSAT per
  ticket (marked used, with an expired token), and one `created` activity-log row per ticket.
  Source ticket types replace the seeded ones (Q8). Categories are flattened as `Parent / Child`.
- **Not imported (yet):** saved views, drafts, canned responses, avatars, user notes,
  notification-address preferences, and the tables MAPPING §4 skips.

## Checking the result

1. Sign in through SurveyJS SSO. Your account is linked to your AnswerDesk user, so it should now
   be an agent.
2. On the agent dashboard, open a few tickets. Check the threads (answers with comments under
   them), code blocks, inline images and the attachment lists. Check private comments as an agent.
3. `import.sh status` shows the counts, including `ticket refs relinked` (posts changed). `$WORK/report.txt` lists what `prepare` skipped and why.

Keep the instance's SMTP unconfigured (Admin → Email) while it holds real data. Otherwise,
replying to an imported ticket emails real customers.

## Starting over

`import.sh reset` does the following:

- Deletes the imported tickets (posts, attachment rows, tags, followers, CSAT and activity cascade).
- Deletes the accounts the import created.
- Removes the SSO identities it added to pre-existing accounts.
- Drops the `adimport` schema.

Raised roles on pre-existing accounts, categories, tags, ticket types, custom fields and the
Storage blobs are kept. A re-import reuses them. To drop the blobs too, delete the
`attachments/migrated/` folder in Studio (Storage), then delete `$WORK/uploaded.txt`.

## Other tools

- `stats.mjs <pkg>` prints aggregate counts and value distributions for the source tables.
- `stats-posts.mjs <pkg>` prints aggregate body-format and authorship counts per post type.
- `lib/source.mjs` is the CSV reader. Column order comes from `source-schema.sql`, and records are
  cut by field count, so embedded newlines are fine. GUID, int and datetime columns are validated.
  A stray `|@|` inside a text value is folded back into that value.

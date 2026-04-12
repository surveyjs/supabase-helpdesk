# Phase 13 — Knowledge Base

## Context

You are building the Knowledge Base (help center) for a **HelpDesk** application. Read `docs/requirements.md` sections 19.1–19.8, 16.18, and `docs/architecture.md` constraints 2, 2c, 5.

Phases 0–12 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, and SLA policies.

This phase adds KB articles (draft/published/archived), the public help center, article management for agents, KB categories management for admins, article feedback, suggested articles on ticket creation, and the "Create ticket from article" flow.

## Tasks

### 1. Migration: `supabase/migrations/012_knowledge_base.sql`

#### KB Categories Table

```sql
CREATE TABLE kb_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE kb_categories ENABLE ROW LEVEL SECURITY;

-- Public read (help center is accessible to everyone when enabled)
CREATE POLICY kb_categories_select ON kb_categories
  FOR SELECT USING (true);
CREATE POLICY kb_categories_insert ON kb_categories
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY kb_categories_update ON kb_categories
  FOR UPDATE USING (is_admin());
CREATE POLICY kb_categories_delete ON kb_categories
  FOR DELETE USING (is_admin());
```

#### KB Articles Table

```sql
CREATE TABLE kb_articles (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(title) <= 300),
  slug TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) <= 100000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  category_id UUID REFERENCES kb_categories(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES profiles(id),
  last_editor_id UUID REFERENCES profiles(id),
  source_ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  not_helpful_count INTEGER NOT NULL DEFAULT 0,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kb_articles_status ON kb_articles (status);
CREATE INDEX idx_kb_articles_category_id ON kb_articles (category_id);
CREATE INDEX idx_kb_articles_author_id ON kb_articles (author_id);

-- Full-text search on KB articles
ALTER TABLE kb_articles ADD COLUMN search_vector tsvector;
CREATE INDEX idx_kb_articles_search ON kb_articles USING GIN (search_vector);

CREATE OR REPLACE FUNCTION update_kb_article_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kb_article_search_vector
  BEFORE INSERT OR UPDATE OF title, body ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION update_kb_article_search_vector();

ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

-- Published articles: everyone can read
-- Draft articles: agents only
-- Archived articles: everyone can read (accessible via direct URL, §19.2)
CREATE POLICY kb_articles_select ON kb_articles
  FOR SELECT USING (
    status IN ('published', 'archived')
    OR is_agent()
  );

-- Agents can create/edit articles
CREATE POLICY kb_articles_insert ON kb_articles
  FOR INSERT WITH CHECK (is_agent());
CREATE POLICY kb_articles_update ON kb_articles
  FOR UPDATE USING (is_agent());
CREATE POLICY kb_articles_delete ON kb_articles
  FOR DELETE USING (is_agent());
```

#### KB Article Feedback Table

```sql
CREATE TABLE kb_article_feedback (
  article_id BIGINT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_helpful BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, user_id)
);

ALTER TABLE kb_article_feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated users can see their own feedback (to show current vote state)
CREATE POLICY kb_article_feedback_select ON kb_article_feedback
  FOR SELECT USING (auth.uid() = user_id OR is_agent());
CREATE POLICY kb_article_feedback_insert ON kb_article_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY kb_article_feedback_update ON kb_article_feedback
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY kb_article_feedback_delete ON kb_article_feedback
  FOR DELETE USING (auth.uid() = user_id);
```

#### Trigger to Maintain Feedback Counts

```sql
CREATE OR REPLACE FUNCTION update_kb_article_feedback_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_helpful THEN
      UPDATE kb_articles SET helpful_count = helpful_count + 1 WHERE id = NEW.article_id;
    ELSE
      UPDATE kb_articles SET not_helpful_count = not_helpful_count + 1 WHERE id = NEW.article_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_helpful AND NOT NEW.is_helpful THEN
      UPDATE kb_articles SET helpful_count = helpful_count - 1, not_helpful_count = not_helpful_count + 1 WHERE id = NEW.article_id;
    ELSIF NOT OLD.is_helpful AND NEW.is_helpful THEN
      UPDATE kb_articles SET helpful_count = helpful_count + 1, not_helpful_count = not_helpful_count - 1 WHERE id = NEW.article_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_helpful THEN
      UPDATE kb_articles SET helpful_count = helpful_count - 1 WHERE id = OLD.article_id;
    ELSE
      UPDATE kb_articles SET not_helpful_count = not_helpful_count - 1 WHERE id = OLD.article_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kb_article_feedback_counts
  AFTER INSERT OR UPDATE OR DELETE ON kb_article_feedback
  FOR EACH ROW EXECUTE FUNCTION update_kb_article_feedback_counts();
```

#### KB Visibility Setting

```sql
INSERT INTO app_settings (key, value) VALUES
  ('kb_visible', 'false')
ON CONFLICT (key) DO NOTHING;
```

### 2. Server Actions for Knowledge Base

**`src/lib/actions/kb.ts`** (new file):

- `createArticle(title, body, categoryId?, status?)`:
  - Require agent role
  - Validate: title (max 300 chars), body (max 100,000 chars), status is 'draft' (default on create)
  - Generate slug from title (same util as tickets)
  - Set `author_id` to current user
  - Insert and redirect to article edit page

- `updateArticle(articleId, title, body, categoryId?)`:
  - Require agent role
  - Validate title and body length
  - Update slug if title changed
  - Set `last_editor_id` to current user, `edited_at = now()`
  - Revalidate

- `changeArticleStatus(articleId, newStatus)`:
  - Require agent role
  - Validate status is 'draft', 'published', or 'archived'
  - Update status
  - Revalidate

- `deleteArticle(articleId)`:
  - Require agent role
  - Delete from `kb_articles`
  - Redirect to management page

- `submitArticleFeedback(articleId, isHelpful)`:
  - Require authenticated user (not unauthenticated visitors per §19.7)
  - Upsert into `kb_article_feedback` — clicking opposite button changes the vote

- `searchArticles(query, page?)`:
  - Search `kb_articles` by `search_vector` (partial match), status = 'published'
  - Return paginated results with title, category, snippet
  - Read page size from `app_settings.other_lists_page_size`

- `getSuggestedArticles(title)`:
  - Search published articles by title similarity (text search)
  - Return up to 5 matching articles with id, title, slug, category
  - Used by ticket creation form for real-time suggestions (§19.6)

- `toggleKbVisibility(visible)`:
  - Require admin role
  - Update `app_settings` key `kb_visible`
  - Log to `admin_audit_log`
  - Revalidate

### 3. Help Center Public Pages

**`src/app/(main)/help/page.tsx`** — Help center landing page:
- Check `kb_visible` setting — if disabled, return 404
- List all KB categories with published article counts, ordered by `display_order`
- Search bar at the top — navigates to `/help?q={query}`
- When search query present: show paginated search results instead of category listing
- Search results: article title (link), category name, body snippet
- Accessible to both authenticated and unauthenticated visitors

**`src/app/(main)/help/[id]/[...slugParts]/page.tsx`** — Article detail page:
- URL format: `/help/{id}/{category-slug}/{article-slug}`
- Fetch article by `id` (authoritative identifier)
- If category slug or article slug don't match: **307 redirect** to correct URL (temporary, §19.2)
- If article is **draft**: return 404 (unless user is an agent — show with "Draft" banner)
- If article is **archived**: show with "This article may be outdated" warning banner
- Render article body as sanitized Markdown HTML (same `renderMarkdown` util as tickets)
- Show "Last updated on {date}" below the body
- **Feedback section** (§19.7):
  - "Was this helpful?" prompt with 👍 / 👎 buttons
  - Authenticated users: highlight their current vote, allow toggling
  - Unauthenticated visitors: buttons disabled or hidden
- **"Still need help?" section** (§19.8):
  - Link: "Create a ticket" — visible only to authenticated users
  - Link navigates to `/tickets/new?from_article={articleId}`
  - Pre-fills title: "Question about: {article title}"
  - Stores `source_article_id` on the ticket

### 4. Article Management Page

**`src/app/(main)/kb/manage/page.tsx`** — Agent article management:
- Require agent role
- **"Knowledge base visible to public"** checkbox at top:
  - All agents can see the current state
  - Only admins can toggle it (disabled for non-admin agents, §19.5)
- Paginated list of all articles (all statuses)
- Columns: title, category, status (draft/published/archived badge), author, last editor, edited date, helpfulness score (👍/👎 counts)
- Sortable by title, status, date, helpfulness
- Filter by status, category
- Search by title
- Each row: link to edit, button to change status, delete button
- "New Article" button → article editor page

**`src/app/(main)/kb/manage/[id]/page.tsx`** — Article editor:
- Require agent role
- Form: title, category (dropdown of KB categories), body (Markdown textarea with preview tab)
- Status display with change buttons (draft → published, etc.)
- If article has a `source_ticket_id`: show "Generated from ticket #{id}" link (§23.5 will use this)
- Save button → `updateArticle` Server Action
- Show original author and last editor

### 5. KB Categories Management (Admin)

Add a new section to the Admin Setup sidebar: **"KB Categories"** (route: `/admin/kb-categories`).

**`src/app/(main)/admin/kb-categories/page.tsx`**:
- Require admin role
- List KB categories with name and display order
- Reorder via up/down buttons or drag-and-drop
- Create new category: name input + add button
- Rename category: inline edit
- Delete category: confirmation prompt; articles in the category get `category_id = NULL`
- Log all changes to `admin_audit_log`

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `createKbCategory(name)` — require admin, validate name, insert, log audit
- `renameKbCategory(categoryId, newName)` — require admin, validate, update, log audit
- `reorderKbCategories(orderedIds)` — require admin, update display_order for each, log audit
- `deleteKbCategory(categoryId)` — require admin, delete (articles set to NULL), log audit

### 6. Ticket Creation Integration

Update `src/app/(main)/tickets/new/page.tsx` (or the ticket creation form component):

- Read `from_article` query param. If present:
  - Fetch the article by ID
  - Pre-fill the ticket title with "Question about: {article title}"
  - Set `source_article_id` on the hidden form field

- **Suggested articles** (§19.6):
  - As the user types in the title field, debounce and call `getSuggestedArticles(title)` after a short delay
  - Display up to 5 matching KB article links below the title field
  - Each link shows article title and category
  - This is a `"use client"` component for the search-as-you-type behavior (architecture constraint 2c)

Update `src/lib/actions/tickets.ts` — `createTicket`:
- Accept optional `sourceArticleId` from form data
- Store in `tickets.source_article_id`

### 7. Source Article Display on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:
- If ticket has `source_article_id` and current user is an agent:
  - Show "Created from article: {article title}" link in the ticket metadata sidebar
  - Link navigates to the article detail page

### 8. NavBar Updates

Update `src/components/layout/NavBar.tsx`:

- **"Help Center"** link:
  - Visible when `kb_visible` is `true`
  - Links to `/help`
  - Shown to all users (authenticated and unauthenticated)

- **"Manage Articles"** link:
  - Visible only to agents/admins
  - Links to `/kb/manage`

Update the Admin Setup sidebar navigation to include the "KB Categories" link.

### 9. Seed Data

Extend `supabase/seed.sql` per `docs/seed-data.md`:

**KB Categories** (2):
- "Getting Started" (display_order: 1)
- "Troubleshooting" (display_order: 2)

**KB Articles** (3):
- "How to create a ticket" — category: Getting Started, status: published, author: Grace (agent)
- "Understanding ticket statuses" — category: Getting Started, status: published, author: Grace
- "Common login issues" — category: Troubleshooting, status: draft, author: Hank (admin)

### 10. Tests

**`tests/db/013-knowledge-base.test.ts`** (new file):
- KB article CRUD (agent can create/edit/delete)
- Published articles visible to all users
- Draft articles visible only to agents
- Archived articles visible to all (via direct access)
- Regular users cannot create/edit articles
- KB categories: admin-only management
- Article search_vector indexes title and body
- Article feedback: user can vote once per article
- Article feedback: changing vote updates counts correctly
- Feedback counts maintained by trigger
- Article CASCADE deletes feedback
- Source article reference stored on ticket
- KB visibility setting controls access

**`tests/e2e/knowledge-base.spec.ts`** (new file):
- Help center page loads with categories (when enabled)
- Help center hidden when KB visibility disabled
- Article detail page renders Markdown
- Archived article shows "outdated" banner
- Draft article returns 404 for regular users
- Draft article visible to agents with "Draft" banner
- Article URL redirect on slug mismatch (307)
- Search articles returns matching results
- Article feedback: thumbs up/down works
- Unauthenticated visitors cannot vote
- "Create a ticket" link on article (authenticated only)
- Ticket creation from article pre-fills title
- Source article shows on ticket detail for agents
- Suggested articles appear on ticket creation form
- Article management page: list, filter, sort
- Article editor: create, edit, change status, delete
- KB categories admin: create, rename, reorder, delete
- KB visibility toggle: admin can toggle, agent sees read-only

## Implementation Notes

- **SEO URLs:** Article URLs use the format `/help/{id}/{category-slug}/{article-slug}`. The `id` is authoritative; slug mismatches trigger a 307 redirect (not 301, because titles/categories may change again).
- **Search:** Use the `search_vector` tsvector column with `plainto_tsquery` for KB search. The trigger auto-updates the search vector on title/body changes.
- **Feedback:** Only authenticated users can vote. The trigger on `kb_article_feedback` maintains the counts on `kb_articles` — no need for manual count queries.
- **Client component for suggestions:** The suggested articles feature on the ticket creation form requires a client component for debounced search-as-you-type. Use `"use client"` with `fetch` to a server action or API endpoint.
- **Markdown rendering:** Reuse the existing `renderMarkdown` function from `src/lib/utils/markdown.ts` for article body rendering.
- **Visibility:** The `kb_visible` setting controls whether the help center is accessible. When disabled, the NavBar hides the link and the help center pages return 404.

## Deferred Features (Added by Later Phases)

- AI-powered duplicate detection showing similar tickets alongside KB suggestions — Phase 19
- Generate KB article from ticket via AI — Phase 19

## Verification Checklist

- [ ] KB categories CRUD works (admin only)
- [ ] KB articles CRUD works (agents)
- [ ] Published articles visible to everyone
- [ ] Draft articles visible only to agents
- [ ] Archived articles show "outdated" banner
- [ ] Article URL format: `/help/{id}/{category-slug}/{article-slug}`
- [ ] Slug mismatch triggers 307 redirect
- [ ] Help center search works (title + body)
- [ ] Help center hidden when KB visibility disabled
- [ ] Article feedback thumbs up/down works for authenticated users
- [ ] Feedback counts accurate and maintained by trigger
- [ ] Suggested articles appear on ticket creation (top 5)
- [ ] "Create a ticket" from article pre-fills title and stores source_article_id
- [ ] Source article link visible on ticket detail for agents
- [ ] NavBar: "Help Center" link conditional on visibility, "Manage Articles" for agents
- [ ] KB visibility checkbox: editable by admin, read-only for agents
- [ ] Seed data: 2 categories, 3 articles
- [ ] `npm run test:db` passes KB tests
- [ ] `npm run test:e2e` passes KB e2e tests

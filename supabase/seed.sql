-- ============================================================
-- Phase 2 — Seed Data: Users & Teams
-- ============================================================
-- Phase 2 seeds ONLY users and teams.
-- Ticket types already exist from Phase 1 migration.
-- This file will be extended in later phases.

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------
-- Users (auth.users)
-- The handle_new_user trigger auto-creates profiles rows.
-- UUIDs use range ...0011 - ...0018 to avoid conflict
-- with test UUIDs in 001-schema.test.ts (which use ...0001 - ...0007).
-- --------------------------------------------------------

DO $$
DECLARE
  _users JSONB := '[
    {"id":"00000000-0000-0000-0000-000000000011","email":"admin@example.com","name":"Admin"},
    {"id":"00000000-0000-0000-0000-000000000012","email":"agent.smith@example.com","name":"Agent Smith"},
    {"id":"00000000-0000-0000-0000-000000000013","email":"agent.jones@example.com","name":"Agent Jones"},
    {"id":"00000000-0000-0000-0000-000000000014","email":"alice@example.com","name":"Alice"},
    {"id":"00000000-0000-0000-0000-000000000015","email":"bob@example.com","name":"Bob"},
    {"id":"00000000-0000-0000-0000-000000000016","email":"carol@example.com","name":"Carol"},
    {"id":"00000000-0000-0000-0000-000000000017","email":"dave@example.com","name":"Dave"},
    {"id":"00000000-0000-0000-0000-000000000018","email":"eve@example.com","name":"Eve"}
  ]'::jsonb;
  _u JSONB;
BEGIN
  FOR _u IN SELECT * FROM jsonb_array_elements(_users) LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous,
      confirmation_token, recovery_token,
      email_change_token_new, email_change_token_current,
      email_change, reauthentication_token, email_change_confirm_status
    ) VALUES (
      (_u->>'id')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated',
      _u->>'email',
      crypt('Password123', gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('display_name', _u->>'name'),
      '{"provider":"email","providers":["email"]}'::jsonb,
      false, false,
      '', '', '', '', '', '', 0
    );
  END LOOP;
END $$;

-- --------------------------------------------------------
-- Identity records (required for email/password login)
-- --------------------------------------------------------

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  id,
  jsonb_build_object('sub', id::text, 'email', email),
  'email',
  id::text,
  now(), now(), now()
FROM auth.users
WHERE id IN (
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000012'::uuid,
  '00000000-0000-0000-0000-000000000013'::uuid,
  '00000000-0000-0000-0000-000000000014'::uuid,
  '00000000-0000-0000-0000-000000000015'::uuid,
  '00000000-0000-0000-0000-000000000016'::uuid,
  '00000000-0000-0000-0000-000000000017'::uuid,
  '00000000-0000-0000-0000-000000000018'::uuid
);

-- --------------------------------------------------------
-- Update profiles: set roles
-- --------------------------------------------------------

UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000011';
UPDATE profiles SET role = 'agent' WHERE id = '00000000-0000-0000-0000-000000000012';
UPDATE profiles SET role = 'agent' WHERE id = '00000000-0000-0000-0000-000000000013';

-- --------------------------------------------------------
-- Team: "Alice's Team" with Alice, Bob, Carol
-- --------------------------------------------------------

INSERT INTO teams (id, name) VALUES ('00000000-0000-0000-0000-000000000110', 'Alice''s Team');

UPDATE profiles SET team_id = '00000000-0000-0000-0000-000000000110' WHERE id IN (
  '00000000-0000-0000-0000-000000000014',
  '00000000-0000-0000-0000-000000000015',
  '00000000-0000-0000-0000-000000000016'
);

-- ============================================================
-- Phase 3 — Seed Data: Tickets, Posts, Comments, Notes
-- ============================================================

-- Get the default ticket type ID (Question)
DO $$
DECLARE
  _type_question UUID;
  _type_issue UUID;
  _type_suggestion UUID;
  _tid1 BIGINT; _tid2 BIGINT; _tid3 BIGINT; _tid4 BIGINT;
  _tid5 BIGINT; _tid6 BIGINT; _tid7 BIGINT; _tid8 BIGINT; _tid9 BIGINT;
BEGIN
  SELECT id INTO _type_question FROM ticket_types WHERE name = 'Question';
  SELECT id INTO _type_issue FROM ticket_types WHERE name = 'Issue';
  SELECT id INTO _type_suggestion FROM ticket_types WHERE name = 'Suggestion';

  -- --------------------------------------------------------
  -- Alice's tickets (3): open, pending, closed
  -- --------------------------------------------------------

  -- Ticket 1: Alice - open, public
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, assigned_agent_id)
  VALUES ('Password reset not working', 'password-reset-not-working', 'open', 'high', 'medium', false, _type_issue,
          '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000012')
  RETURNING id INTO _tid1;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid1, '00000000-0000-0000-0000-000000000014',
    E'I tried to reset my password using the forgot password link but I never received the email. I have checked my spam folder.\n\n**Steps to reproduce:**\n1. Click "Forgot password"\n2. Enter email\n3. Wait for email — never arrives',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid1, '00000000-0000-0000-0000-000000000012',
    'Hi Alice, I can see the reset email was sent successfully from our end. Could you please check if you have any email filters that might be blocking it? Also, please verify the email address you used.',
    'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid1, '00000000-0000-0000-0000-000000000014',
    'I double-checked and it is the correct email. No filters found either. Still not receiving it.',
    'post');

  -- Agent note (will render in Phase 6)
  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid1, '00000000-0000-0000-0000-000000000012',
    'Checked mail logs — delivery confirmed. Might be ISP-level blocking. Escalating to email team.',
    'note');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid1, '00000000-0000-0000-0000-000000000014');

  -- Ticket 2: Alice - pending, private
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, assigned_agent_id)
  VALUES ('Feature request: dark mode', 'feature-request-dark-mode', 'pending', 'low', 'low', true, _type_suggestion,
          '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000013')
  RETURNING id INTO _tid2;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid2, '00000000-0000-0000-0000-000000000014',
    'Would love to see a **dark mode** option in the application. Working late at night and the bright screen is hard on the eyes.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid2, '00000000-0000-0000-0000-000000000013',
    'Thanks for the suggestion! We have this on our roadmap. Marking as pending while we evaluate the timeline.',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid2, '00000000-0000-0000-0000-000000000014');

  -- Ticket 3: Alice - closed
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id)
  VALUES ('How to export data?', 'how-to-export-data', 'closed', 'medium', 'low', false, _type_question,
          '00000000-0000-0000-0000-000000000014')
  RETURNING id INTO _tid3;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid3, '00000000-0000-0000-0000-000000000014',
    'How can I export my data to CSV? I looked in the settings but could not find an export option.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid3, '00000000-0000-0000-0000-000000000012',
    E'Go to **Settings > Data > Export** and select CSV format. You can also use the API endpoint `/api/export`.\n\nLet me know if that helps!',
    'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid3, '00000000-0000-0000-0000-000000000014',
    'Found it, thank you!',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid3, '00000000-0000-0000-0000-000000000014');

  -- --------------------------------------------------------
  -- Bob's tickets (2): one open (public), one closed (duplicate)
  -- --------------------------------------------------------

  -- Ticket 4: Bob - open, public
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id)
  VALUES ('Billing shows wrong amount', 'billing-shows-wrong-amount', 'open', 'critical', 'high', false, _type_issue,
          '00000000-0000-0000-0000-000000000015')
  RETURNING id INTO _tid4;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid4, '00000000-0000-0000-0000-000000000015',
    E'My invoice for this month shows $299 but my plan is $99/month. This is the third time this has happened.\n\n```\nInvoice #12345\nAmount: $299.00\nExpected: $99.00\n```',
    true, 'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid4, '00000000-0000-0000-0000-000000000015');

  -- Ticket 5: Bob - closed, duplicate of ticket 1 (Alice's password reset)
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, duplicate_of_id)
  VALUES ('Cannot reset password', 'cannot-reset-password', 'closed', 'medium', 'medium', false, _type_issue,
          '00000000-0000-0000-0000-000000000015', _tid1)
  RETURNING id INTO _tid5;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid5, '00000000-0000-0000-0000-000000000015',
    'When I try to reset my password, the reset email never arrives. I have tried multiple times.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid5, '00000000-0000-0000-0000-000000000012',
    E'This ticket has been closed as a duplicate of [#' || _tid1 || '](/tickets/' || _tid1 || '/password-reset-not-working).',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid5, '00000000-0000-0000-0000-000000000015');

  -- --------------------------------------------------------
  -- Carol's tickets (2): one open, one pending
  -- --------------------------------------------------------

  -- Ticket 6: Carol - open, private
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, assigned_agent_id)
  VALUES ('Bug in search results', 'bug-in-search-results', 'open', 'high', 'high', true, _type_issue,
          '00000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000012')
  RETURNING id INTO _tid6;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid6, '00000000-0000-0000-0000-000000000016',
    E'The search feature is returning completely irrelevant results. When I search for "billing", I get results about "password reset".\n\nThis started happening after the last update.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid6, '00000000-0000-0000-0000-000000000012',
    'Thanks for reporting this. We have identified the issue with the search indexing. Working on a fix now.',
    'post');

  -- Comment (will render in Phase 6)
  INSERT INTO posts (ticket_id, author_id, body, post_type, parent_post_id)
  VALUES (_tid6, '00000000-0000-0000-0000-000000000016',
    'Any ETA on the fix?',
    'comment',
    (SELECT id FROM posts WHERE ticket_id = _tid6 AND author_id = '00000000-0000-0000-0000-000000000012' AND post_type = 'post' LIMIT 1));

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid6, '00000000-0000-0000-0000-000000000016');

  -- Ticket 7: Carol - pending, public
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id)
  VALUES ('How to change notification settings?', 'how-to-change-notification-settings', 'pending', 'low', 'low', false, _type_question,
          '00000000-0000-0000-0000-000000000016')
  RETURNING id INTO _tid7;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid7, '00000000-0000-0000-0000-000000000016',
    'Where can I find the notification settings? I am getting too many email notifications.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid7, '00000000-0000-0000-0000-000000000013',
    E'You can manage your notifications from **Profile > Notification Settings**.\n\nYou can:\n- Disable email notifications entirely\n- Choose which events trigger notifications\n- Set a digest frequency\n\nDoes that help?',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid7, '00000000-0000-0000-0000-000000000016');

  -- --------------------------------------------------------
  -- Dave's tickets (2): one open, one closed (no team)
  -- --------------------------------------------------------

  -- Ticket 8: Dave - open, public
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id)
  VALUES ('Suggestion: keyboard shortcuts', 'suggestion-keyboard-shortcuts', 'open', 'low', 'low', false, _type_suggestion,
          '00000000-0000-0000-0000-000000000017')
  RETURNING id INTO _tid8;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid8, '00000000-0000-0000-0000-000000000017',
    E'It would be great to have keyboard shortcuts for common actions:\n\n- `Ctrl+N` — New ticket\n- `Ctrl+Enter` — Submit reply\n- `Esc` — Close modal\n\nThis would greatly improve productivity for power users.',
    true, 'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid8, '00000000-0000-0000-0000-000000000017');

  -- Ticket 9: Dave - closed, private
  INSERT INTO tickets (title, slug, status, urgency, severity, is_private, type_id, creator_id, assigned_agent_id)
  VALUES ('Login issue on mobile', 'login-issue-on-mobile', 'closed', 'medium', 'medium', true, _type_issue,
          '00000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000013')
  RETURNING id INTO _tid9;

  INSERT INTO posts (ticket_id, author_id, body, is_original, post_type)
  VALUES (_tid9, '00000000-0000-0000-0000-000000000017',
    'I cannot log in from my phone (iPhone 15, Safari). The login button does not respond to taps. Works fine on desktop.',
    true, 'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid9, '00000000-0000-0000-0000-000000000013',
    'We have identified and fixed the touch event handling issue on iOS Safari. The fix is deployed. Could you try again?',
    'post');

  INSERT INTO posts (ticket_id, author_id, body, post_type)
  VALUES (_tid9, '00000000-0000-0000-0000-000000000017',
    'It works now. Thank you for the quick fix!',
    'post');

  INSERT INTO ticket_followers (ticket_id, user_id) VALUES (_tid9, '00000000-0000-0000-0000-000000000017');

  -- Eve has 0 tickets (testing empty state per §3.3)

  -- ============================================================
  -- Phase 5 — Categories, Tags, and Assignments
  -- ============================================================

  -- Categories (3)
  INSERT INTO categories (id, name) VALUES
    ('00000000-0000-0000-0000-000000000201', 'Billing'),
    ('00000000-0000-0000-0000-000000000202', 'Technical'),
    ('00000000-0000-0000-0000-000000000203', 'Account');

  -- Tags (5, with distinct colors)
  INSERT INTO tags (id, name, color) VALUES
    ('00000000-0000-0000-0000-000000000301', 'urgent', '#EF4444'),
    ('00000000-0000-0000-0000-000000000302', 'bug', '#F97316'),
    ('00000000-0000-0000-0000-000000000303', 'feature-request', '#3B82F6'),
    ('00000000-0000-0000-0000-000000000304', 'documentation', '#14B8A6'),
    ('00000000-0000-0000-0000-000000000305', 'UI', '#8B5CF6');

  -- Category assignments on existing tickets
  -- Ticket 1 (Password reset not working) → Account
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000203' WHERE id = _tid1;
  -- Ticket 4 (Billing shows wrong amount) → Billing
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000201' WHERE id = _tid4;
  -- Ticket 6 (Bug in search results) → Technical
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000202' WHERE id = _tid6;
  -- Ticket 8 (Suggestion: keyboard shortcuts) → Technical
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000202' WHERE id = _tid8;
  -- Ticket 9 (Login issue on mobile) → Account
  UPDATE tickets SET category_id = '00000000-0000-0000-0000-000000000203' WHERE id = _tid9;

  -- Tag assignments on existing tickets (2-3 tags per ticket, 5 tickets)
  -- Ticket 1 → urgent, bug
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid1, '00000000-0000-0000-0000-000000000301'),
    (_tid1, '00000000-0000-0000-0000-000000000302');
  -- Ticket 2 → feature-request
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid2, '00000000-0000-0000-0000-000000000303');
  -- Ticket 4 → urgent, bug, UI
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid4, '00000000-0000-0000-0000-000000000301'),
    (_tid4, '00000000-0000-0000-0000-000000000302'),
    (_tid4, '00000000-0000-0000-0000-000000000305');
  -- Ticket 6 → bug, UI
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid6, '00000000-0000-0000-0000-000000000302'),
    (_tid6, '00000000-0000-0000-0000-000000000305');
  -- Ticket 8 → feature-request, documentation
  INSERT INTO ticket_tags (ticket_id, tag_id) VALUES
    (_tid8, '00000000-0000-0000-0000-000000000303'),
    (_tid8, '00000000-0000-0000-0000-000000000304');

  -- ============================================================
  -- Phase 12 — SLA Policies
  -- ============================================================

  -- Override severity on 3 tickets for SLA visibility
  UPDATE tickets SET severity = 'critical' WHERE id = _tid1;
  UPDATE tickets SET severity = 'high' WHERE id = _tid3;
  UPDATE tickets SET severity = 'critical' WHERE id = _tid5;

END $$;

-- SLA Policy (outside DO block — does not reference local variables)
INSERT INTO sla_policies (id, name, first_response_minutes, resolution_minutes)
VALUES ('00000000-0000-0000-0000-000000000401', 'Standard SLA', 240, 1440)
ON CONFLICT DO NOTHING;

-- Severity mapping: Critical and High → Standard SLA; Low and Medium unmapped
UPDATE sla_severity_mapping SET sla_policy_id = '00000000-0000-0000-0000-000000000401' WHERE severity = 'critical';
UPDATE sla_severity_mapping SET sla_policy_id = '00000000-0000-0000-0000-000000000401' WHERE severity = 'high';

-- ============================================================
-- Phase 13 — Knowledge Base: Categories & Articles
-- ============================================================

-- KB Categories (2)
INSERT INTO kb_categories (id, name, display_order) VALUES
  ('00000000-0000-0000-0000-000000000501', 'Getting Started', 1),
  ('00000000-0000-0000-0000-000000000502', 'Troubleshooting', 2);

-- KB Articles (3)
-- Article 1: "How to create a ticket" — Getting Started, published, author: Agent Smith
INSERT INTO kb_articles (id, title, slug, body, status, category_id, author_id) VALUES
  (1, 'How to create a ticket', 'how-to-create-a-ticket',
   E'# How to Create a Ticket\n\nCreating a ticket is easy! Follow these steps:\n\n1. Click **My Tickets** in the navigation bar\n2. Click the **Create Ticket** button\n3. Fill in the **Title** with a short summary of your issue\n4. Select the appropriate **Type** and **Urgency**\n5. Describe your issue in the **Description** field (Markdown supported)\n6. Click **Create Ticket**\n\n## Tips\n\n- Be as specific as possible in your description\n- Include any error messages you see\n- Attach screenshots if they help explain the issue\n\nOnce submitted, an agent will review your ticket and respond as soon as possible.',
   'published', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000012');

-- Article 2: "Understanding ticket statuses" — Getting Started, published, author: Agent Smith
INSERT INTO kb_articles (id, title, slug, body, status, category_id, author_id) VALUES
  (2, 'Understanding ticket statuses', 'understanding-ticket-statuses',
   E'# Understanding Ticket Statuses\n\nEvery ticket in the system has a status that indicates its current state:\n\n| Status | Meaning |\n|--------|----------|\n| **Open** | The ticket has been created and is awaiting agent review |\n| **In Progress** | An agent is actively working on the ticket |\n| **Pending** | The agent is waiting for more information from you |\n| **Resolved** | The issue has been addressed |\n| **Closed** | The ticket is complete and no further action is needed |\n\n## What to Do\n\n- If your ticket is **Pending**, check for agent replies and respond\n- If **Resolved** but the issue persists, reply to reopen it\n- **Closed** tickets can no longer be replied to (unless an agent reopens)\n\nNeed further help? Create a ticket!',
   'published', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000012');

-- Article 3: "Common login issues" — Troubleshooting, draft, author: Admin
INSERT INTO kb_articles (id, title, slug, body, status, category_id, author_id) VALUES
  (3, 'Common login issues', 'common-login-issues',
   E'# Common Login Issues\n\nIf you are having trouble logging in, try the following:\n\n## Forgot Password\n\n1. Click **Forgot Password** on the login page\n2. Enter your email address\n3. Check your inbox for a reset link\n4. Follow the link to set a new password\n\n## Account Not Found\n\nIf you receive an "account not found" error:\n- Make sure you are using the correct email address\n- Check if you signed up with a different email\n- Contact support if the issue persists\n\n## Browser Issues\n\n- Clear your browser cache and cookies\n- Try a different browser or incognito mode\n- Ensure JavaScript is enabled',
   'draft', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000011');

-- Reset sequence for kb_articles id
SELECT setval('kb_articles_id_seq', 3);

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

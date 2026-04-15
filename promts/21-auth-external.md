# Phase 21 — Authentication Modes (External SSO)

## Context

You are building configurable authentication modes — built-in with social OAuth providers and external OAuth/OIDC delegation — for a **HelpDesk** application. Read `docs/requirements.md` sections 1, 16.13, 20.2, 20.3, and `docs/architecture.md` constraint 4.

Phases 0–20 are complete: project init, database schema, authentication (email/password), tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, SLA policies, knowledge base, reporting, user profile/account management, canned responses/follow/custom fields, advanced ticket operations, inbound email, AI features, and subscription tiers.

This phase extends the authentication system from email/password-only to support social OAuth providers (Google, GitHub, Microsoft, GitLab) in built-in mode and full external OAuth/OIDC delegation.

### Existing Infrastructure

- **Authentication**: `src/lib/actions/auth.ts` — `login()`, `signup()`, `forgotPassword()`, `resetPassword()`, `signOut()`. Currently email/password only.
- **Login page**: `src/app/(auth)/login/page.tsx` — email/password form.
- **Signup page**: `src/app/(auth)/signup/page.tsx` — email/password form.
- **Middleware**: `src/middleware.ts` — refreshes Supabase session via `@supabase/ssr`.
- **Supabase client helpers**: `src/lib/supabase/` — server, client, middleware clients.
- **Profile page**: user profile with "Change password" section, display name editing.
- **App settings table** (`app_settings`) — key-value store.
- **Admin setup page** at `/admin` with sidebar sections. This phase adds the "Authentication" section.
- **Supabase Vault** — for encrypting OAuth client secrets.
- **Admin audit log** — for logging auth mode changes.
- **Auth callback route**: `src/app/auth/callback/route.ts` — handles OAuth callback from Supabase Auth (may exist from Phase 2 or needs updating for social/external providers).

## Tasks

### 1. Migration: `supabase/migrations/019_auth_external.sql`

```sql
-- ============================================================
-- Phase 21 — Authentication Modes (External SSO)
-- ============================================================

-- Authentication mode and provider configuration
INSERT INTO app_settings (key, value) VALUES
  ('auth_mode', 'built-in'),                  -- 'built-in' or 'external'
  -- Social OAuth providers (built-in mode)
  ('auth_google_enabled', 'false'),
  ('auth_github_enabled', 'false'),
  ('auth_microsoft_enabled', 'false'),
  ('auth_microsoft_tenant_id', ''),
  ('auth_gitlab_enabled', 'false'),
  ('auth_gitlab_instance_url', ''),            -- optional self-hosted URL
  -- External OAuth/OIDC provider
  ('auth_external_provider_name', ''),         -- display name for login button
  ('auth_external_issuer_url', ''),            -- OIDC discovery URL
  ('auth_external_scopes', 'openid email profile'),
  ('auth_external_auto_redirect', 'false')     -- auto-redirect to external provider
ON CONFLICT (key) DO NOTHING;

-- OAuth client credentials stored in Supabase Vault:
-- 'auth_google_client_id', 'auth_google_client_secret'
-- 'auth_github_client_id', 'auth_github_client_secret'
-- 'auth_microsoft_client_id', 'auth_microsoft_client_secret'
-- 'auth_gitlab_client_id', 'auth_gitlab_client_secret'
-- 'auth_external_client_id', 'auth_external_client_secret'
-- (Stored/retrieved via vault.create_secret / vault.decrypted_secrets)
```

### 2. Server Actions: Auth Configuration

**`src/lib/actions/auth-config.ts`** (new file):

- `updateAuthMode(formData: FormData)`:
  - Require admin role
  - Extract: `mode` (`'built-in'` or `'external'`)
  - If switching modes: no destructive action (existing users remain, per §16.13)
  - Update `app_settings` key `auth_mode`
  - Log in `admin_audit_log`: action `'auth_mode_changed'`, details `{ from, to }`
  - Revalidate

- `updateSocialProvider(formData: FormData)`:
  - Require admin role
  - Extract: `provider` (google/github/microsoft/gitlab), `enabled` (boolean), `client_id`, `client_secret`, and provider-specific fields (`tenant_id` for Microsoft, `instance_url` for GitLab)
  - Validate: if enabling, client_id and client_secret are required
  - Store client_id and client_secret in Supabase Vault (update existing or create new)
  - Update `app_settings` keys for the provider
  - Configure the Supabase Auth provider via the Supabase Management API or by updating `supabase/config.toml` settings programmatically
  - Log in `admin_audit_log`
  - Revalidate

- `updateExternalProvider(formData: FormData)`:
  - Require admin role
  - Extract: `provider_name`, `client_id`, `client_secret`, `issuer_url`, `scopes`, `auto_redirect`
  - Validate: issuer_url is a valid URL, scopes is a space-separated list
  - Store client_id and client_secret in Supabase Vault
  - Update `app_settings` keys
  - Configure the Supabase Auth OIDC provider
  - Log in `admin_audit_log`
  - Revalidate

- `testAuthConnection(formData: FormData)`:
  - Require admin role
  - Extract: `provider` (google/github/microsoft/gitlab/external)
  - Attempt to validate the configuration:
    - For social providers: verify client credentials format and attempt a token endpoint discovery
    - For external OIDC: fetch the `issuer_url + /.well-known/openid-configuration` and verify it returns valid endpoints
  - Return success/error message

- `getRedirectUri(provider: string)`:
  - Return the auto-generated redirect URI for the specified provider
  - Format: `{appUrl}/auth/callback` (standard Supabase Auth callback)

### 3. Update Login Page

Update `src/app/(auth)/login/page.tsx`:

- **Built-in mode:**
  - Show email/password form (existing)
  - Below the form, for each enabled social provider, show a **"Sign in with {Provider}"** button:
    - "Sign in with Google" (Google icon)
    - "Sign in with GitHub" (GitHub icon)
    - "Sign in with Microsoft" (Microsoft icon)
    - "Sign in with GitLab" (GitLab icon)
  - Each button calls `supabase.auth.signInWithOAuth({ provider: 'google' | 'github' | 'azure' | 'gitlab' })` which redirects to the provider
  - Social provider buttons are fetched from `app_settings` at render time

- **External mode:**
  - If `auth_external_auto_redirect` is `'true'` and no `?no_redirect=true` query param:
    - Automatically redirect to the external provider's login page
    - Use `supabase.auth.signInWithOAuth({ provider: 'oidc', options: { ... } })`
  - If auto-redirect is disabled or `?no_redirect=true` is present:
    - Show a single button: **"Sign in with {provider_name}"**
    - No email/password form
  - The `/login?no_redirect=true` URL is always accessible for troubleshooting

### 4. Update Signup Page

Update `src/app/(auth)/signup/page.tsx`:

- **Built-in mode:**
  - Show email/password signup form (existing)
  - Below the form, show social provider buttons (same as login — "Sign up with {Provider}")
  - Social OAuth automatically creates profiles via the existing auth trigger

- **External mode:**
  - Show a message: "Account creation is managed by your organization's identity provider."
  - Show the "Sign in with {provider_name}" button (which handles both sign-in and first-time sign-up via the external provider)

### 5. Update Auth Callback Route

Update `src/app/auth/callback/route.ts`:

- Handle the OAuth callback from Supabase Auth
- Exchange the code for a session using `supabase.auth.exchangeCodeForSession(code)`
- Handle new user auto-provisioning: the existing profile creation trigger (from Phase 2) should fire for new OAuth users
- For external OIDC users signing in for the first time: extract display name from the token claims (e.g., `name` or `preferred_username`) and set it on the profile
- Redirect to the appropriate page (default: `/tickets`)

### 6. Update Profile Page

Update the user profile page:

- **Change password section**:
  - In **external mode**: hide the section entirely (§16.13)
  - In **built-in mode**: hide for users who authenticated via a social OAuth provider (check `auth.users.app_metadata.provider` — if not `'email'`, hide the section)
  - Otherwise: show as normal
- **Display name editing**: always available regardless of auth mode (§16.13)

### 7. Update Middleware for Auto-Redirect

Update `src/middleware.ts`:

- If auth mode is `'external'` and `auth_external_auto_redirect` is `'true'`:
  - For unauthenticated requests to protected routes: redirect to `/login` (which will auto-redirect to the external provider)
  - For requests to `/login` without `?no_redirect=true`: let the login page handle the redirect
  - Do NOT auto-redirect for public pages (help center, public tickets) — §16.13

### 8. Admin UI: Authentication Configuration

Add a new sidebar section to the admin setup page:

**Route**: `/admin/auth` (add to admin sidebar navigation)

**Auth mode selection card:**
- Radio buttons: **Built-in** (default) / **External (OAuth/OIDC)**
- Confirmation prompt when switching: "Switching authentication mode will affect how all users sign in. Continue?"
- Informational text explaining each mode's behavior

**Built-in mode settings** (shown when "Built-in" is selected):
- **Social OAuth providers** — one card per provider (Google, GitHub, Microsoft, GitLab):
  - **Enable/disable toggle**
  - **Client ID** — text input
  - **Client Secret** — password input (masked after saving)
  - Provider-specific fields:
    - Microsoft: **Tenant ID** — text input
    - GitLab: **Instance URL** — text input (optional, for self-hosted)
  - **"Test Connection"** button
  - **"Save"** button per provider
- All credentials stored in Supabase Vault, displayed masked after saving

**External mode settings** (shown when "External" is selected):
- **Provider name** — text input (display name for the login button, e.g., "SurveyJS SSO")
- **Client ID** — text input
- **Client Secret** — password input (masked after saving)
- **Issuer URL** — text input (OIDC discovery URL)
- **Scopes** — text input (default: `openid email profile`)
- **Redirect URI** — read-only field with "Copy" button (auto-generated)
- **Auto-redirect** — toggle (default: off)
- **"Test Connection"** button
- **"Save"** button

All changes recorded in admin audit log.

### 9. Tests

**`tests/db/020-auth-external.test.ts`** (new file):

- **Auth settings:**
  - All auth-related `app_settings` keys exist with correct defaults
  - `auth_mode` defaults to `'built-in'`
  - Admin can update auth settings

**`tests/e2e/auth-external.spec.ts`** (new file):

- **Admin auth configuration:**
  - Admin can navigate to `/admin/auth`
  - Can switch between built-in and external modes (with confirmation)
  - Can configure social provider credentials (input fields visible when enabled)
  - Client secret field masks input
  - "Test Connection" button is present for each provider
  - Settings persist after save
  - Can configure external provider settings
  - Redirect URI is shown as read-only
  - Auto-redirect toggle works

- **Login page in built-in mode:**
  - Email/password form is visible
  - Enabled social provider buttons appear
  - Disabled social providers are not shown
  - Clicking social button initiates OAuth flow (mock or redirect test)

- **Login page in external mode:**
  - No email/password form shown
  - Single "Sign in with {provider_name}" button
  - Auto-redirect: navigating to `/login` redirects to external provider (if enabled)
  - `/login?no_redirect=true` shows login page without redirect

- **Signup page in built-in mode:**
  - Standard signup form + social buttons

- **Signup page in external mode:**
  - No signup form
  - Message about external provider management
  - "Sign in with {provider_name}" button

- **Profile page:**
  - Built-in mode + email auth: change password section visible
  - Built-in mode + social auth: change password section hidden
  - External mode: change password section hidden
  - Display name editing always available

- **Mode switching:**
  - Switch from built-in to external: confirmation prompt shown
  - Switch back: existing users can still access (via forgot password or social)

## Implementation Notes

- **Supabase Auth provider configuration**: Supabase supports configuring OAuth providers via the dashboard or the Management API. For a self-hosted setup, provider credentials are configured in `supabase/config.toml` or via environment variables. The admin setting Server Actions should update the Supabase Auth configuration programmatically. If the Management API is not available (local dev), store the configuration in `app_settings` and apply it at runtime.
- **OAuth callback**: Supabase Auth handles the OAuth flow. The app only needs to handle the callback (`/auth/callback`) where it exchanges the code for a session.
- **External OIDC**: Supabase Auth supports generic OIDC providers. Configure it via the Auth settings with the issuer URL, client ID, and secret. Supabase auto-discovers endpoints from `/.well-known/openid-configuration`.
- **Auto-redirect**: Implemented at the login page level (client-side redirect on mount) rather than in middleware, to keep the middleware simple. The middleware ensures session refresh only.
- **Social provider buttons**: Use the provider's official brand colors and icons. Button order: Google, GitHub, Microsoft, GitLab (but only show enabled ones).
- **First-time OAuth users**: The existing profile creation trigger (from Phase 2) fires on `auth.users` INSERT. For OAuth users, the trigger should extract `raw_user_meta_data.full_name` or `raw_user_meta_data.name` and set it as `display_name`.
- **Credential encryption**: All client secrets and external provider secrets are stored in Supabase Vault using the same pattern as AI API keys (Phase 19). The admin UI displays them as masked after saving.

## Verification Checklist

- [ ] `auth_mode` setting with `'built-in'` (default) and `'external'` options
- [ ] Social OAuth providers: Google, GitHub, Microsoft, GitLab configurable
- [ ] Each social provider: enable/disable toggle, client ID, client secret
- [ ] Microsoft: tenant ID field; GitLab: optional instance URL field
- [ ] All credentials stored in Supabase Vault, displayed masked
- [ ] "Test Connection" button per provider
- [ ] External OIDC: provider name, client ID, secret, issuer URL, scopes, redirect URI
- [ ] Auto-redirect toggle for external mode
- [ ] Login page: social buttons in built-in mode, single button in external mode
- [ ] Signup page: social buttons in built-in mode, informational text in external mode
- [ ] Auth callback handles OAuth code exchange and session creation
- [ ] First-time OAuth users get profile created with display name from token claims
- [ ] Change password section hidden for social/external auth users
- [ ] Display name editing always available
- [ ] `/login?no_redirect=true` always accessible
- [ ] Auto-redirect does not affect public pages
- [ ] Mode switching confirms with admin
- [ ] All auth changes recorded in admin audit log
- [ ] `npm run test:db` passes auth-external tests
- [ ] `npm run test:e2e` passes auth-external tests

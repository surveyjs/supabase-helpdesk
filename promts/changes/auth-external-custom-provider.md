# Change: External SSO via Supabase Custom Providers (SurveyJS auth out of the box)

## Summary

Phase 21 added an **External (OAuth/OIDC)** authentication mode, but sign-in through it
cannot work today:

1. `LoginForm.tsx` / `SignupForm.tsx` call `signInWithOAuth({ provider: 'oidc' })`. Supabase Auth
   has no provider named `oidc` (the call is hidden behind `@ts-expect-error`), so the redirect
   to `/auth/v1/authorize` fails with "unsupported provider".
2. `updateExternalProvider()` only writes the issuer URL to `app_settings` and the client ID /
   secret to Vault. Nothing registers the provider with Supabase Auth, so GoTrue never learns it
   exists.
3. `getRedirectUri()` returns `{appUrl}/auth/callback`. That is the *app* redirect after Supabase
   finishes; the URI an admin must register at the identity provider is
   `{SUPABASE_URL}/auth/v1/callback`.

The installed `@supabase/auth-js` (2.103) supports **custom providers**: register one through
`supabase.auth.admin.customProviders.createProvider(...)` with an identifier like
`custom:external`, then sign in with `signInWithOAuth({ provider: 'custom:external' })`.
Rewire the external mode on top of that.

**Primary goal:** an admin must be able to switch to External mode, pick the **SurveyJS**
preset, paste a client ID and secret, and have login work against `https://auth.surveyjs.io`
with no other input. Generic OIDC / OAuth2 providers remain supported as a secondary goal.

## What `https://auth.surveyjs.io` actually is

Verified from `https://auth.surveyjs.io/.well-known/openid-configuration` (do not re-derive):

| Field | Value |
|---|---|
| `issuer` | `https://auth.surveyjs.io` |
| `authorization_endpoint` | `https://auth.surveyjs.io/OAuth/Authorize` |
| `token_endpoint` | `https://auth.surveyjs.io/OAuth/Token` |
| `userinfo_endpoint` | `https://auth.surveyjs.io/OAuth/UserInfo` |
| `end_session_endpoint` | `https://auth.surveyjs.io/OAuth/Logout` |
| `jwks_uri` | `https://auth.surveyjs.io/.well-known/jwks` → returns `{"keys":[]}` |
| `response_types_supported` | `["code"]` |
| `id_token_signing_alg_values_supported` | `["HS256"]` |
| `token_endpoint_auth_methods_supported` | `["client_secret_post"]` |
| `code_challenge_methods_supported` | `["S256"]` |
| `scopes_supported` | `openid profile email` |
| `claims_supported` | `sub email name` |

Consequences that drive the design:

- **It must be registered as `provider_type: 'oauth2'`, not `'oidc'`.** ID tokens are HS256
  (signed with the client secret) and the JWKS is empty, so Supabase's OIDC mode — which
  verifies the ID token against `jwks_uri` — rejects every login. In OAuth2 mode Supabase
  ignores the ID token and reads the user from `userinfo_url`.
- PKCE S256 is supported → `pkce_enabled: true`.
- The token endpoint accepts the client secret **only in the POST body**
  (`client_secret_post`). Confirm during the manual test (see **Verification**) that the
  Supabase token exchange succeeds; if it fails with `invalid_client`, look for a client-auth
  style option on the custom-provider API and set it, and record the outcome in this file.

## Prerequisites (already in place)

| What | Where |
|---|---|
| External-mode settings & admin form | `src/lib/actions/auth-config.ts`, `src/app/(main)/admin/auth/ExternalAuthSurveyForm.tsx`, `src/components/features/survey/form-json/admin/auth-external.json` |
| Login / signup external buttons + auto-redirect | `src/app/(auth)/login/LoginForm.tsx`, `src/app/(auth)/signup/SignupForm.tsx` |
| App-side callback (code → session, display name) | `src/app/auth/callback/route.ts` |
| Vault RPCs for client id/secret | `store_oauth_secret`, `get_oauth_secret`, `has_oauth_secret`, `delete_oauth_secret` in `supabase/migrations/001_initial_schema.sql` (service role only) |
| Service-role client (needed for the admin API) | `createServiceRoleClient()` in `src/lib/supabase/server.ts` |
| Custom-provider admin API types | `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` → `GoTrueAdminCustomProvidersApi`, `CreateCustomProviderParams`, `UpdateCustomProviderParams` |
| Existing tests to keep green | `tests/db/020-auth-external.test.ts`, `tests/e2e/auth-external.spec.ts`, `tests/helpers/auth.ts` |

Read the Supabase docs for custom OAuth/OIDC providers before coding (`attribute_mapping`
shape, whether `discovery_url` vs. explicit URLs are required per type, plan/version
requirements). Check that the local stack (Supabase CLI 2.117) exposes
`/auth/v1/admin/custom-providers`; if it does not, bump the CLI / auth image first and note it
in this file.

## Changes

### 1. Settings: add provider type, preset and OAuth2 endpoints

Extend the `app_settings` seed in `supabase/migrations/001_initial_schema.sql` (this project
has a single consolidated migration — edit it in place, no new migration file):

```sql
('auth_external_preset', 'surveyjs'),       -- 'surveyjs' | 'oidc' | 'oauth2'
('auth_external_authorization_url', ''),    -- oauth2 preset only
('auth_external_token_url', ''),            -- oauth2 preset only
('auth_external_userinfo_url', ''),         -- oauth2 preset only
('auth_external_registered', 'false'),      -- 'true' while an enabled custom provider exists in Supabase Auth
('auth_external_last_error', ''),           -- last registration error, '' when the last attempt succeeded
```

There is deliberately **no** `provider_type` setting: the Supabase provider type is *derived*
from the preset (`surveyjs` → `oauth2`, `oidc` → `oidc`, `oauth2` → `oauth2`) in one place
(`resolveExternalProvider`, §2) on both server and client, so the two can never disagree.

Keep the existing keys (`auth_external_provider_name`, `auth_external_issuer_url`,
`auth_external_scopes`, `auth_external_auto_redirect`). Update `AuthConfigSettings` and
`getAuthConfigSettings()` accordingly.

### 2. Pure builder: settings → Supabase custom-provider params

New file `src/lib/auth/external-provider.ts` (no `'use server'`, no I/O — unit-testable):

```ts
export const EXTERNAL_PROVIDER_ID = 'custom:external' as const;

export const SURVEYJS_PRESET = {
  provider_name: 'SurveyJS',
  provider_type: 'oauth2',
  authorization_url: 'https://auth.surveyjs.io/OAuth/Authorize',
  token_url: 'https://auth.surveyjs.io/OAuth/Token',
  userinfo_url: 'https://auth.surveyjs.io/OAuth/UserInfo',
  issuer_url: 'https://auth.surveyjs.io',
  scopes: 'openid email profile',
} as const;

export type ExternalProviderSettings = { /* the auth_external_* keys as strings */ };

/**
 * Resolves preset → concrete settings, including `provider_type`
 * (surveyjs fills every field and is always oauth2; oidc/oauth2 use admin input).
 * This is the only place the provider type is decided.
 */
export function resolveExternalProvider(s: ExternalProviderSettings): ResolvedExternalProvider;

/** Maps resolved settings + credentials to CreateCustomProviderParams for the admin API. */
export function buildCustomProviderParams(
  resolved: ResolvedExternalProvider,
  creds: { clientId: string; clientSecret: string },
): CreateCustomProviderParams;

/** Validation for the admin form: returns an error string or null. */
export function validateExternalProvider(s: ExternalProviderSettings, hasCreds: boolean): string | null;
```

Rules for `buildCustomProviderParams`:

- `identifier: EXTERNAL_PROVIDER_ID`, `name: provider_name`, `enabled: true`,
  `pkce_enabled: true`, `email_optional: false`, `scopes: scopes.split(/\s+/)`.
- `provider_type === 'oidc'` → set `issuer` (and `discovery_url = issuer + '/.well-known/openid-configuration'` if the API wants it explicit).
- `provider_type === 'oauth2'` → set `authorization_url`, `token_url`, `userinfo_url`.
- Add an `attribute_mapping` only if the manual test shows `name` does not land in
  `user_metadata` (the SurveyJS userinfo returns standard `sub`/`email`/`name`, which GoTrue
  should pick up unmapped). If needed, use the shape from the Supabase docs.

Validation: `oidc` requires a valid `issuer_url`; `oauth2` requires all three URLs valid
`https:` URLs; `surveyjs` requires nothing beyond credentials; credentials (client ID and
secret in Vault, or supplied in this save) are required to register.

### 3. Server action: register the provider with Supabase Auth

Rewrite `updateExternalProvider()` in `src/lib/actions/auth-config.ts`:

1. Require admin (existing helper).
2. Read `preset`, `provider_name`, `issuer_url`, `authorization_url`, `token_url`,
   `userinfo_url`, `scopes`, `auto_redirect`, `client_id`, `client_secret` from the form.
   Run `resolveExternalProvider` — for `preset === 'surveyjs'` it ignores submitted endpoint
   fields and uses `SURVEYJS_PRESET` (the form hides them — see §5 — but the server must not
   trust that).
3. `validateExternalProvider(...)`; on error return `{ error }` **before** touching Vault or
   settings.
4. Store client ID / secret in Vault (only if non-empty), persist all `auth_external_*`
   settings.
5. Call `registerExternalProvider()` (below) and return its result.
6. Audit log `external_provider_updated` with `{ preset, provider_type, provider_name, registered }`.
7. Revalidate `/admin/auth`, `/login`, `/signup`.

New exported action `registerExternalProvider(): Promise<{ error?: string }>` (admin only).
It reads the saved settings + Vault credentials and syncs Supabase Auth. It is also wired to
an explicit **"Register with Supabase Auth"** button (§5) so an admin can retry after a
transient failure *without changing any field*.

**Never break a working provider.** Registration must be an all-or-nothing swap:

- `getProvider(EXTERNAL_PROVIDER_ID)` → `previous` (may be null). Keep the previous
  credentials too: read them from Vault *before* `updateExternalProvider` overwrites them
  (pass them in, or snapshot them under `auth_external_client_id_prev` /
  `_secret_prev` Vault names).
- Same `provider_type` as `previous` → `updateProvider(id, params)`. On failure the old
  provider is untouched and still works: leave `auth_external_registered` as it was, write
  the message to `auth_external_last_error`, return `{ error }`.
- Different type (immutable on update) or no `previous` → `createProvider` is needed. If
  `previous` exists: `deleteProvider` → `createProvider(newParams)`; if create fails,
  immediately `createProvider(previousParams + previous creds)` to restore. Report the
  original error either way; set `auth_external_registered = 'false'` **only if the restore
  also failed** (i.e. no provider exists any more), otherwise keep `'true'` and say in the
  error that the previous configuration is still active.
- On success: `auth_external_registered = 'true'`, `auth_external_last_error = ''`, delete
  the `_prev` Vault snapshots.
- `auth_external_registered` must reflect reality: after any failure path, call
  `getProvider` once more and set the flag from whether an enabled provider exists.

`updateAuthMode()`: when switching to `external`, if `auth_external_registered !== 'true'`
return `{ error: 'Configure and register the external provider before switching to External mode.' }`
— an unregistered provider would lock every user out of the login page. (This is why the
external form must be usable in Built-in mode — §5.)

`testAuthConnection('external')`:
- `surveyjs` / `oauth2`: `GET authorization_url` with a 10 s timeout and treat any HTTP response
  (including 4xx — the endpoint needs params) as reachable; also `GET userinfo_url` and expect
  401/403 (reachable, rejects anonymous).
- `oidc`: existing discovery check.
- All presets: `admin.customProviders.getProvider(EXTERNAL_PROVIDER_ID)` must succeed and
  report `enabled: true`; include `identifier` and `provider_type` in `details`.

`getRedirectUri()`: return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`.
This is what the admin registers at auth.surveyjs.io. Keep `NEXT_PUBLIC_APP_URL`-based
`/auth/callback` only as the `redirectTo` used by `signInWithOAuth` in the client.

### 4. Login / signup: use the custom provider identifier

In `LoginForm.tsx` and `SignupForm.tsx` replace every `provider: 'oidc'` with
`provider: EXTERNAL_PROVIDER_ID` and delete the `@ts-expect-error` lines (the `custom:${string}`
template type is in `Provider`). Extract a single `signInWithExternalProvider()` helper in
`src/lib/supabase/external-sign-in.ts` ('use client'-safe, takes the browser client) so the
button, the auto-redirect effect and the signup button share one code path. If
`signInWithOAuth` returns `{ error }` (it only does so before the redirect — e.g. provider
disabled or URL construction failed), show it inline (`data-testid="external-login-error"`)
instead of failing silently.

**Callback failures must not loop.** Token-exchange and userinfo failures happen *after* the
redirect and surface only in `src/app/auth/callback/route.ts`, which today redirects to
`/login?error=auth_callback_error`; with auto-redirect on, the login page would immediately
start the OAuth flow again. Therefore:
- The callback route redirects failures to `/login?error=auth_callback_error&no_redirect=true`
  and, when Supabase passes `error` / `error_description` query params to the callback, keeps
  a sanitized `error_description` (max 200 chars, plain text) as `error_detail`.
- `LoginForm` renders the callback error (`data-testid="auth-callback-error"`: "Sign-in with
  {provider_name} failed. {error_detail}") above the button, in both modes.
- The auto-redirect effect skips when **either** `no_redirect` **or** `error` is present in
  the query string. Never auto-redirect from a page that is showing an error.

`getPublicAuthConfig()` already returns `authMode`, `externalProviderName`, `autoRedirect`;
add `externalRegistered: boolean`. When External mode is on but the provider is not
registered, the login page shows a plain message ("External sign-in is not configured.
Contact your administrator.") and does **not** auto-redirect. Note `/login?no_redirect=true`
only suppresses the redirect; it does not expose password login in External mode, so an
admin who locks themselves out must fix it in the database — the registration guard in §3
and the swap-or-restore logic exist to make that unnecessary.

### 5. Admin form: preset-driven UI

Update `auth-external.json` (SurveyJS form) and `ExternalAuthSurveyForm.tsx`:

**The form must be usable in Built-in mode.** Today `src/app/(main)/admin/auth/page.tsx`
renders the external form, the Redirect URI card and the Test button only when
`mode === 'external'`, which makes the §3 registration guard impossible to satisfy. Render
the "External provider" card in **both** modes, under the mode selector, with a short intro
in Built-in mode: "Configure and register the provider here first, then switch the mode to
External." Only the *login/signup behaviour* depends on `auth_mode`; configuration does not.

- New first question `preset` — `dropdown`, choices
  `surveyjs` ("SurveyJS (auth.surveyjs.io)"), `oidc` ("Generic OpenID Connect"),
  `oauth2` ("Generic OAuth 2.0"); default `surveyjs`. There is no separate provider-type
  control: the preset *is* the type (see §1).
- `provider_name` — for `surveyjs` default to "SurveyJS" (`defaultValueExpression`), editable.
- `issuer_url` — `visibleIf: {preset} = 'oidc'`.
- `authorization_url`, `token_url`, `userinfo_url` — `inputType: url`,
  `visibleIf: {preset} = 'oauth2'`, `isRequired: true` when visible.
- For `surveyjs` show a read-only `html` block listing the preset endpoints and a note:
  "ID tokens from auth.surveyjs.io are HS256-signed, so this provider is registered as
  OAuth 2.0 and the user is read from the UserInfo endpoint."
- `client_id`, `client_secret` — unchanged; placeholder "•••••• (saved)" when
  `auth_external_client_id_present`.
- `scopes`, `auto_redirect` — unchanged.
- The Redirect URI card (`CopyRedirectUriButton.tsx`) shows the new Supabase callback URI with
  the help text "Register this URL as the allowed redirect URI at your identity provider."
- Show a status line under the form: "Registered with Supabase Auth ✓ / Not registered" from
  `auth_external_registered`, plus `auth_external_last_error` when non-empty,
  `data-testid="external-provider-status"`.
- A **"Register with Supabase Auth"** button (`data-testid="external-provider-register"`)
  next to Test Connection, calling `registerExternalProvider()` directly. It is the retry
  path: `AdminSurveyForm` skips a submit whose data equals the last saved snapshot, and after
  a reload the snapshot is seeded from persisted settings, so "Save again with nothing
  changed" can never re-run registration — this button bypasses that on purpose.

Switch the form from `mode="autosave"` to `mode="complete"` (explicit Save button, already
supported by `AdminSurveyForm`): registering with Supabase Auth on every keystroke is wrong.

**Error propagation.** `ExternalAuthSurveyForm.saveAction` currently turns `{ error }` into
`{ message: 'Error: …' }`, which `AdminSurveyForm` treats as *success* — it advances
`lastSavedSnapshotRef`, so the next identical submit is silently skipped. Return the action's
`{ error }` unchanged so the snapshot is held back and the failed submission can be retried.
Do the same audit in `SocialAuthSurveyForm.tsx` and fix it if it has the same bug.

### 6. Callback route

`src/app/auth/callback/route.ts` already sets the display name from
`user_metadata.name` for non-email providers; `custom:external` flows through unchanged.
Verify during the manual test that `app_metadata.provider === 'custom:external'` and that
`user_metadata.name` / `email` are populated; if the userinfo claims arrive under a different
key, add it to the fallback chain (do not add an attribute mapping just for this unless the
chain cannot cover it).

`src/app/(main)/profile/page.tsx` already hides the password section when
`app_metadata.provider !== 'email'` — no change, but add an e2e assertion (see tests).

### 7. Documentation

- `.env.local.example`: comment that External mode needs `SUPABASE_SERVICE_ROLE_KEY` (used
  for the custom-provider admin API) and that the IdP redirect URI is
  `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`.
- `README.md` → Authentication section: add "SurveyJS SSO preset" with the three-step setup
  (create a client at auth.surveyjs.io with the redirect URI → paste ID/secret in
  `/admin/auth` → switch mode to External).
- `promts/21-auth-external.md` Implementation Notes: replace the "generic OIDC provider"
  paragraph with a pointer to this file.

## Tests

**Unit** — `src/lib/auth/__tests__/external-provider.test.ts` (Vitest, same layout as
`src/lib/tickets/__tests__/`):
- `resolveExternalProvider` with `preset: 'surveyjs'` yields the exact SurveyJS endpoints,
  `provider_type: 'oauth2'`, scopes `openid email profile`, regardless of submitted URL fields;
  `preset: 'oidc'` → `provider_type: 'oidc'`; `preset: 'oauth2'` → `'oauth2'`.
- `buildCustomProviderParams` for `surveyjs` → `identifier: 'custom:external'`,
  `provider_type: 'oauth2'`, `pkce_enabled: true`, `authorization_url/token_url/userinfo_url`
  set, no `issuer`.
- `buildCustomProviderParams` for `oidc` → `issuer` set, no OAuth2 URLs.
- `validateExternalProvider`: missing creds → error; `oauth2` with an `http:` URL → error;
  `oidc` with invalid issuer → error; `surveyjs` with creds → null.

**DB** — extend `tests/db/020-auth-external.test.ts`:
- New keys exist with the defaults from §1.
- Admin can round-trip the new keys; reset to defaults in `afterEach` as the file already does.

**Unit** — `src/lib/actions/__tests__/register-external-provider.test.ts` with a mocked
`customProviders` API (the swap-or-restore logic in §3 is the riskiest code and must not
depend on a live stack):
- update path failure → previous provider untouched, `registered` unchanged, `last_error` set.
- type change: delete → create fails → restore with previous params is called; `registered`
  stays `'true'`; error returned mentions the previous configuration is active.
- type change: delete → create fails → restore fails → `registered = 'false'`.
- success clears `last_error` and `_prev` snapshots.

**E2E** — extend `tests/e2e/auth-external.spec.ts` (respect the `auth_mode` reset helpers in
`tests/helpers/auth.ts`; these tests must leave `auth_mode = 'built-in'`):
- **Complete first-time setup through the UI only, starting in Built-in mode, with no direct
  `app_settings` writes**: open `/admin/auth` → external card is visible in Built-in mode →
  preset SurveyJS → dummy credentials → Save → status "Registered" → switch mode to External
  (confirm) → `/login?no_redirect=true` shows "Sign in with SurveyJS" → switch back to
  Built-in. This is the acceptance path for finding-free setup.
- Admin form: preset defaults to SurveyJS; endpoint fields hidden; switching to
  "Generic OAuth 2.0" reveals the three URL fields; "Generic OpenID Connect" reveals issuer.
- Saving the SurveyJS preset without credentials shows the validation error and does not
  flip `auth_external_registered`.
- After a registration, `admin.customProviders.getProvider('custom:external')` (via the
  service-role client in the test) returns `provider_type: 'oauth2'` and the SurveyJS
  `authorization_url`.
- Switching to External mode while unregistered is refused with the message from §3.
- Failed save is retryable: submit an invalid Generic OAuth 2.0 config (`http:` URL) → error
  shown → submit the **same** data again → the error is shown again (proves the snapshot was
  not advanced); then click "Register with Supabase Auth" with nothing changed → the action
  runs (assert on the status line / a spy'd audit-log row).
- Login page in External mode with a registered provider: clicking
  `external-login-btn` navigates to a URL starting with `${SUPABASE_URL}/auth/v1/authorize`
  and containing `provider=custom%3Aexternal` (intercept the navigation; do not follow it to
  auth.surveyjs.io).
- Login page in External mode with `auth_external_registered = 'false'`: the
  not-configured message is shown, no auto-redirect happens.
- **No redirect loop**: with External mode + auto-redirect on, open
  `/login?error=auth_callback_error&no_redirect=true` → `auth-callback-error` is visible and,
  after 2 s, the page is still `/login` (no navigation to `/auth/v1/authorize`). Also hit
  `/auth/callback?error=access_denied&error_description=x` and assert it lands on
  `/login?error=…&no_redirect=true`.
- Redirect URI card shows `${SUPABASE_URL}/auth/v1/callback`, in both modes.

Existing e2e tests that assert the old `/auth/callback` redirect URI text must be updated.

## Verification

1. `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:db`,
   `npm run test:e2e -- auth-external` all pass; the full e2e suite still passes (the auth
   helpers' `auth_mode` reset must keep working).
2. **Manual end-to-end against auth.surveyjs.io** (this is the acceptance test — the automated
   tests cannot prove the token exchange). Ask the user for a client ID and secret registered
   at auth.surveyjs.io with redirect URI `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`
   (for local dev that is `http://127.0.0.1:54321/auth/v1/callback`; if the IdP refuses
   non-HTTPS redirect URIs, test against the hosted Supabase project instead). Then:
   - `/admin/auth` → preset SurveyJS → paste credentials → Save → status "Registered".
   - Test Connection → success, details show `custom:external` / `oauth2`.
   - Switch mode to External → `/login` → "Sign in with SurveyJS" → authenticate at
     auth.surveyjs.io → land on `/tickets` logged in.
   - In `auth.users`: `app_metadata.provider = 'custom:external'`, `email` set,
     `raw_user_meta_data.name` set; `profiles.display_name` equals the SurveyJS name.
   - Profile page hides "Change password".
   - Sign out, sign in again → same user (no duplicate account).
3. Record in this file, under a new **Implementation status** heading: the Supabase auth
   version that was used, whether `client_secret_post` worked without extra configuration,
   and whether an `attribute_mapping` was needed.

## Out of scope

- Registering the *social* providers (Google/GitHub/Microsoft/GitLab) with Supabase Auth
  programmatically — `updateSocialProvider()` has the same gap, but those are configured in
  `config.toml` / the dashboard today; leave as is.
- Front-channel logout via `end_session_endpoint`.
- Supporting more than one external provider at a time (the single `custom:external` slot
  is intentional).

## Implementation status

**Implemented; the automated suites pass. The manual end-to-end test against auth.surveyjs.io
(Verification step 2) is still pending, because it needs a real client ID and secret.**

- **Supabase Auth version:** local stack from Supabase CLI 2.117.0 runs GoTrue **v2.188.1**,
  which exposes `/auth/v1/admin/custom-providers`. No CLI or image bump was needed.
- **Admin API behaviour, checked against the local stack:**
  - `oauth2` providers must use `https:` URLs. GoTrue rejects anything else with
    `validation_failed: URL must use HTTPS`, so `validateExternalProvider` requires `https:` too.
  - `oidc` providers need only `issuer`. GoTrue fetches and stores the discovery document
    itself, so no explicit `discovery_url` is sent.
  - A missing provider returns 404 `custom_provider_not_found`, which is treated as "no
    previous provider".
  - `provider_type` / `identifier` are immutable, so they are stripped from `updateProvider`.
- **`client_secret_post`:** *not yet verified.* The custom-provider API has no client-auth-style
  option (see `CreateCustomProviderParams` in auth-js 2.103). If the manual test fails with
  `invalid_client`, it needs a GoTrue-side change.
- **`attribute_mapping`:** none is sent. Whether `name` / `email` land in `user_metadata` is
  still to be confirmed in the manual test; `/auth/callback` already falls back through
  `full_name → name → preferred_username → user_name`.
- **Design notes / deviations:**
  - The swap-or-restore logic lives in `src/lib/auth/external-provider-sync.ts`, with its
    dependencies injected. `registerExternalProvider()` / `updateExternalProvider()` in
    `auth-config.ts` wire it to the service-role client. The unit test
    (`src/lib/actions/__tests__/register-external-provider.test.ts`) drives it with a mocked
    `customProviders` API.
  - Previous credentials are snapshotted in Vault as `auth_external_client_{id,secret}_prev`
    by `snapshotPreviousCredentials()`. A complete existing snapshot is kept, because it
    belongs to the provider that is still active after an earlier failed attempt. A partial
    snapshot is replaced. A new snapshot is read back and verified. If any Vault step fails,
    the partial snapshot is removed and the save aborts before the current credentials are
    overwritten. Vault read errors are raised, never treated as "absent", so a failed read can
    never make the newly submitted credentials the restore point. On success the snapshots are
    deleted; if that deletion fails, the error is reported, because a stale snapshot would
    restore the wrong credentials later.
  - `auth_external_registered` changes only on a confirmed state: an enabled provider → `true`;
    404 or `enabled: false` → `false`. If the follow-up `getProvider` fails (e.g. a 503), the
    status is `registered: null` and the stored flag is left alone. Only `last_error` is
    written, so an admin API outage cannot lock users out after Supabase recovers.
  - The OIDC issuer is stored and sent exactly as entered (trimmed only), because issuers are
    compared exactly, trailing slash included. The trailing slash is dropped only when building
    the `/.well-known/openid-configuration` URL for Test Connection.
  - `SurveyJsonForm` / `AdminSurveyForm` gained a `keepOpen` option for complete mode. Without
    it, SurveyJS hides the form after Save, so a failed save could not be resubmitted. The
    external form uses `mode="complete"` + `keepOpen`.
  - `AdminSurveyForm` still skips a complete-mode submit that equals the saved snapshot, but
    now shows "No changes to save." instead of doing nothing.
  - `defaultValueExpression` for `provider_name` does not run when the form is seeded with
    `data`. `ExternalAuthSurveyForm` therefore seeds "SurveyJS" itself, and the server falls
    back to it too.
  - `SocialAuthSurveyForm` had the same `{ error }` → `{ message }` bug. It now passes the
    action's result through unchanged.
  - An enabled `custom:external` provider can also be reached in Built-in mode through a
    hand-built `/auth/v1/authorize?provider=custom:external` URL. This matches how
    `enabled: true` is specified; it becomes relevant only if Built-in deployments must block
    external sign-ups.

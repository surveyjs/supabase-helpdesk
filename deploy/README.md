# HelpDesk — operator guide

HelpDesk runs with Docker Compose on one Linux host, in one of two modes:

- **bundled** — Supabase's official self-hosted stack (`supabase/`, unmodified) runs here too, on
  the same domain as HelpDesk;
- **external** — HelpDesk uses Supabase Cloud or a Supabase you run elsewhere.

What runs:

| Service     | Role |
|-------------|------|
| `app`       | HelpDesk (Next.js). Starts only when the database schema matches the image. |
| `scheduler` | Calls the SLA and notification jobs of `app`. |
| `migrate`   | One-off: the only thing that changes the schema (`docker compose run --rm migrate`). |
| `proxy`     | Caddy: the public entry of the domain. Supabase's API paths (`/auth/v1`, `/rest/v1`, `/storage/v1`, `/realtime/v1`, `/functions/v1`, `/graphql/v1`) go to Supabase's gateway, everything else to `app`. |

In bundled mode only `proxy` listens on public ports. Supabase's gateway (with Studio) listens on
`127.0.0.1:8000`; the database and the pooler are not published at all.

## 1. Requirements

- Linux with Docker Engine and the Compose plugin **v2.24.4 or later** (`docker compose version`;
  the bundle uses `include` and the `!reset` merge tag).
- A DNS name for HelpDesk (`help.example.com`) pointing at the host.
- Ports 80 and 443 free for `proxy` (unless your own reverse proxy takes them — section 8).
- Bundled mode runs about a dozen Supabase containers: size the host for them (see Supabase's
  self-hosting guide), not just for HelpDesk.

## 2. Install — bundled Supabase

Unpack the bundle of the version (`helpdesk-deploy-vX.Y.Z.tar.gz` from the GitHub release) into an
empty directory, e.g. `/opt/helpdesk`, and run everything below from there.

1. Generate `.env` (fresh secrets for Supabase and HelpDesk):

   ```sh
   docker run --rm ghcr.io/surveyjs/supabase-helpdesk:X.Y.Z \
     init-env --mode bundled --app-url https://help.example.com --version X.Y.Z > .env
   chmod 600 .env
   ```

   Keep a copy of `.env` somewhere safe: it holds the database password and the keys.

2. Email for sign-up confirmation and password recovery: fill in `SMTP_ADMIN_EMAIL`, `SMTP_HOST`,
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER_NAME` in `.env`. Without SMTP set
   `ENABLE_EMAIL_AUTOCONFIRM=true` (users are confirmed without an email).

3. Create the schema (a new database, so there is nothing to back up yet):

   ```sh
   docker compose run --rm migrate --backup-confirmed
   ```

4. Start everything:

   ```sh
   docker compose up -d
   ```

   Caddy obtains the certificate for the domain of `APP_URL` on first start (ports 80 and 443 must
   be reachable from the internet).

5. Create the first administrator; the command prints a one-time password:

   ```sh
   docker compose run --rm app admin create --email you@example.com
   ```

   Lost it? `docker compose run --rm app admin reset-password --email you@example.com`.

## 3. Install — external Supabase

1. Generate `.env`:

   ```sh
   docker run --rm ghcr.io/surveyjs/supabase-helpdesk:X.Y.Z \
     init-env --mode external --app-url https://help.example.com --version X.Y.Z > .env
   chmod 600 .env
   ```

2. Fill in your project's values (Supabase Cloud: Project Settings → API, and Project Settings → Database):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
   - `MIGRATION_DB_URL` — the **direct** connection or the **session** pooler (port 5432), not the
     transaction pooler: `migrate` holds a lock for the whole session.
   - In Supabase Auth settings set Site URL to `APP_URL` and add `APP_URL/**` to the redirect URLs.

3. Then the same as bundled: `docker compose run --rm migrate --backup-confirmed`,
   `docker compose up -d`, `docker compose run --rm app admin create --email you@example.com`.
   On a project that already has data, take a backup first — `migrate` applies nothing without
   `--backup-confirmed` and prints the UTC time to restore to.

## 4. Upgrade

```sh
./upgrade.sh X.Y.Z                 # asks before applying migrations
./upgrade.sh --migrate X.Y.Z       # no terminal (CI, cron): migrations are pre-approved
./upgrade.sh --bundle FILE X.Y.Z   # use a downloaded bundle instead of the GitHub release
```

`upgrade.sh` unpacks the new bundle (`.env`, `backups/` and data stay), shows what `migrate` would
change and the database size, asks for confirmation, then:

- bundled: stops the stack and snapshots the Postgres data directory into `backups/`;
- external: relies on your provider's backups (PITR) and records the restore point;

and migrates, starts the new version and waits until `/api/health` reports it.

| Exit | Meaning |
|------|---------|
| 0 | Upgraded. |
| 1 | Error before any change (bad arguments, wrong bundle, download failed). Nothing changed. |
| 2 | Migrations pending but not confirmed (no terminal and no `--migrate`). Nothing changed. |
| 3 | Failed; the schema is unchanged and the previous version runs again. |
| 4 | Failed after the schema changed; HelpDesk stays stopped. Fix and upgrade again, or roll back. |

## 5. Rollback

```sh
./upgrade.sh --rollback            # asks for confirmation; --yes without a terminal
```

- **Bundled:** restores the snapshot taken before the last upgrade (the whole database — auth,
  storage metadata, HelpDesk data) and the previous version. Everything written since the upgrade
  is lost.
- **External:** Supabase has no in-place restore. `--rollback` prints the restore point; restore
  the project to it (Dashboard → Database → Backups → Point in time, or the Management API
  `restore-pitr`), then run `./upgrade.sh --rollback --restored` to start the previous version.

## 6. Backups

- `upgrade.sh` keeps the last 3 snapshots of the database in `backups/` (bundled mode). They are
  taken with the stack stopped, so they are consistent. Copy them off the host if you need more.
- For regular backups of a bundled installation: stop the stack (`docker compose stop`), archive
  `supabase/volumes/db/data` and `supabase/volumes/storage` (uploaded files) as root — the files
  belong to the containers' users — and start again.
- **Never delete the `db-config` volume** (`helpdesk_db-config`): it holds the pgsodium/Vault key
  of the database. Without it the encrypted secrets in the database (and in every snapshot) cannot
  be decrypted. `docker compose down -v` deletes it — use `docker compose down` without `-v`.
  Back it up once, and keep that copy forever (it is not a `db-*` snapshot, so `upgrade.sh` never
  rotates it; copy it off the host too):

  ```sh
  docker run --rm -v helpdesk_db-config:/k:ro -v "$PWD/backups:/b" alpine:3.22 \
    tar -C /k -czf /b/vault-key-db-config.tar.gz .
  ```

## 7. Supabase Studio

Studio is reachable only from the host, through the gateway on `127.0.0.1:8000`. From your machine:

```sh
ssh -L 8000:127.0.0.1:8000 you@host
```

then open <http://localhost:8000> and sign in with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`
from `.env`.

## 8. Your own reverse proxy (Traefik, nginx)

Generate `.env` with `init-env ... --edge own`. Then `proxy` (Caddy) does not take ports 80/443: it
listens on `127.0.0.1:8080` and on `proxy:80` in the compose network, without TLS.

- Your proxy terminates TLS for the domain and sends **all** of its traffic to one upstream:
  `proxy:80` from the Docker network (Traefik: see `examples/traefik.yml`) or `127.0.0.1:8080` from
  the host.
- Caddy stays as the internal router: your proxy does not need to know Supabase's paths, and
  must not route them elsewhere.
- Pass WebSockets through (`/realtime/v1`, live updates). nginx:

  ```nginx
  location / {
      proxy_pass http://127.0.0.1:8080;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
  }
  ```

  (Caddy replaces `X-Forwarded-*` headers from your proxy with its own; HelpDesk and Supabase take
  their public URLs from `.env`, not from these headers.)

## 9. Troubleshooting

- **`app` keeps restarting and its log says "Run the migration explicitly"** — the database schema
  does not match the image (new installation, or an upgrade done by hand). Run
  `docker compose run --rm migrate --dry-run` to see what it would apply, then
  `docker compose run --rm migrate --backup-confirmed` once you have a backup (without that flag
  `migrate` applies nothing and exits with 2), then `docker compose restart app`.
- **The log says the database is newer than the image** — you started an older version on an
  upgraded database: `./upgrade.sh --rollback`, or start the newer version again.
- `docker compose ps` shows health; `docker compose logs -f app proxy` shows what happens.

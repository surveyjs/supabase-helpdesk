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
- **One bundled installation per Docker host.** Supabase's compose file gives its containers fixed
  names (`supabase-db`, `supabase-auth`, …), so a second bundled installation, or any other stack
  from Supabase's official compose file, cannot run on the same host.

`supabase/` is Supabase's own `docker/` directory, unmodified. Do not use its scripts
(`setup.sh`, `update.sh`, `run.sh`, `reset.sh`): they act on `supabase/.env`, which this
installation does not use (everything is in `.env` here), and **`reset.sh` deletes the database**.
`upgrade.sh` upgrades Supabase together with HelpDesk.

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
./upgrade.sh --help
```

The mode comes from `COMPOSE_FILE` in `.env` (or exported in the shell, which wins, as in
`docker compose`): bundled when it includes `compose.bundled.yaml`. `SUPABASE_URL` must agree (empty for bundled, set for external), otherwise `upgrade.sh` stops with
exit 1 before changing anything.

`upgrade.sh` checks that the bundle is the one of X.Y.Z, unpacks it over this directory (`.env`,
`backups/` and data stay, even if a bundle contains them; the replaced files are saved in
`backups/files-<previous>-<UTC>.tgz`), pulls the images (bundled: also `alpine:3.22`, which takes
the snapshot) and runs `migrate --dry-run`. With pending migrations — or a bundle with another
Supabase version (`supabase/VENDORED`; Supabase migrates its own schemas when it starts) — it
prints them and the database size and asks `Apply …? [y/N]` (without a terminal `--migrate` is
that yes). Up to here any stop — an error, `n`, Ctrl-C — puts the previous files back: nothing
changed. Then:

- bundled: stops the whole stack and snapshots the Postgres data directory into
  `backups/db-<previous>-<UTC>.tar.gz`, checks the archive (not empty, a Postgres data directory),
  then starts the database again;
- external: relies on your provider's backups (PITR) and records the restore point `migrate` prints;

and migrates, starts the new version and waits until `/api/health` reports it. `proxy` is always
recreated (Caddy reads the `Caddyfile` only at start), and every service when the bundle changed
anything under `supabase/`. Without pending migrations and without a new Supabase version it only
restarts HelpDesk on the new version (no snapshot). The way back is recorded in `.upgrade-state`
for `--rollback`.

| Exit | Meaning |
|------|---------|
| 0 | Upgraded. |
| 1 | Error before any change (bad arguments, wrong bundle, download failed, image missing, `migrate --dry-run` refused, e.g. a database newer than X.Y.Z, or failed because the stack is not running — bundled mode needs it up: `docker compose up -d`, except after an interrupted Supabase upgrade, see below). Nothing changed. |
| 2 | Migrations pending, or a Supabase upgrade, not confirmed (answered no, or no terminal and no `--migrate`). Nothing changed. |
| 3 | Failed before the schema changed (snapshot, migration or start of X.Y.Z); the previous version was restarted. If the script also says it did not become healthy, check `docker compose ps` and `docker compose logs app`. |
| 4 | Failed after the schema changed (or after a new Supabase version started); HelpDesk stays stopped and `.env` keeps the previous version. Fix the cause and run `./upgrade.sh` again (the run continues the upgrade and keeps the snapshot taken before it), or roll back. |
| 130, 143 | Interrupted (Ctrl-C, `kill`). Before the confirmation: the previous files are back, nothing changed. Later: HelpDesk may be stopped, as with exit 4 — run `./upgrade.sh X.Y.Z` again (it continues) or `./upgrade.sh --rollback`. |

**A Supabase upgrade that stopped before its snapshot** (interrupted, or failed while stopping the
stack): the new `supabase/` files are in place, but the new Supabase has not run. `upgrade.sh`
says so. Run `./upgrade.sh --rollback`: it puts back the previous files and starts the previous
stack (there is no snapshot to restore). Do **not** start the stack with `docker compose up -d`:
that starts the new Supabase without a snapshot. A run of `./upgrade.sh X.Y.Z` while the stack
still runs continues the Supabase upgrade: it asks again and takes the snapshot first.

## 5. Rollback

```sh
./upgrade.sh --rollback            # asks for confirmation; --yes without a terminal
```

It undoes the last upgrade — one step, to the version recorded in `.upgrade-state`:

- **Bundled:** restores the snapshot taken before that upgrade (the whole database — auth,
  storage metadata, HelpDesk data), the previous files and version. Everything written since the
  upgrade is lost. The snapshot is unpacked next to the current data first; if that fails, the
  current database stays as it was (exit 1, the stack stopped). If that upgrade had no migrations there is no snapshot: only the files and the
  version go back.
- **External:** Supabase has no in-place restore. `--rollback` prints the restore point and stops
  (exit 1); restore the project to it (Dashboard → Database → Backups → Point in time, or the
  Management API `restore-pitr`), then run `./upgrade.sh --rollback --restored` (`--yes` too
  without a terminal) to start the previous version.

## 6. Backups

- `upgrade.sh` keeps the last 3 snapshots of the database, `backups/db-*.tar.gz` (bundled mode),
  plus the one `.upgrade-state` points at, and deletes older ones — do not name your own archives
  `db-*.tar.gz` there. They are taken with
  the stack stopped, so they are consistent, and hold the database only, not the uploaded files in
  `supabase/volumes/storage` (as with Supabase's own backups). Copy them off the host if you need more.
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
    sh -c 'umask 077; tar -C /k -czf /b/vault-key-db-config.tar.gz .'
  ```

- `backups/` is readable by its owner only (`upgrade.sh` keeps it at mode 700, and snapshots are
  written with mode 600): keep it that way, and keep copies as private.

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
      proxy_set_header X-Forwarded-Proto $scheme;
  }
  ```

- Your proxy must send `Host` and `X-Forwarded-Proto: https` (Traefik does by default): HelpDesk
  builds its redirects (sign-in, `/auth/callback`) from them. Caddy keeps the `X-Forwarded-*`
  headers only from the addresses in `TRUSTED_PROXIES` (`.env`; `--edge own` writes
  `private_ranges` — the Docker networks and localhost) and replaces them for anyone else, so
  redirects would go to `http://`. If your proxy reaches Caddy from a public address, list it
  there (space-separated IPs or CIDRs) and run `docker compose up -d proxy`.

## 9. Troubleshooting

- **`app` keeps restarting and its log says "Run the migration explicitly"** — the database schema
  does not match the image (new installation, or an upgrade done by hand). Run
  `docker compose run --rm migrate --dry-run` to see what it would apply, then
  `docker compose run --rm migrate --backup-confirmed` once you have a backup (without that flag
  `migrate` applies nothing and exits with 2), then `docker compose restart app`.
- **The log says the database is newer than the image** — you started an older version on an
  upgraded database: `./upgrade.sh --rollback`, or start the newer version again.
- `docker compose ps` shows health; `docker compose logs -f app proxy` shows what happens.

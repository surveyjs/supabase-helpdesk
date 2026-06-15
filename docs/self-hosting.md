# Self-Hosting HelpDesk

Runbook for moving HelpDesk off Vercel + Supabase Cloud onto our own
infrastructure. There are **two independent instances on two separate
machines** — they share nothing:

| Instance | Machine | Purpose | Data |
|---|---|---|---|
| **internal** | **Dedicated** machine, helpdesk only | Company helptracker — replacement for https://surveyjs.answerdesk.io/ | Real customer data (migrated from Answer Desk) |
| **showcase** | **Shared demos** machine, alongside other surveyjs examples (each its own docker) | Public demo of the open-source project | Throwaway; reset nightly |

Domains:

| Role | Internal (helpdesk machine) | Showcase (demos machine) |
|---|---|---|
| App | `helpdesk.surveyjs.io` | `helpdesk.demos.surveyjs.io` |
| Supabase API | `supabase.helpdesk.surveyjs.io` | `supabase.helpdesk.demos.surveyjs.io` |
| Webhook | `deploy.helpdesk.surveyjs.io` | (demos machine's own deploy hook) |

All deployment artifacts live in [`deploy/`](../deploy/). Both instances use the
same overlay shape (`deploy/<instance>/docker-compose.app.yml` merged onto the
official `supabase/docker` compose) and the same per-machine `redeploy.sh`
selected by `INSTANCE`. The difference is the edge: the **helpdesk machine ships
its own Caddy** (`deploy/proxy/`); the **demos machine has no proxy of ours** —
the showcase joins the demos host's shared **Traefik** and routes via labels.

---

## 0. Architecture

```
  ┌──────────── DEDICATED helpdesk machine ───────────┐   ┌──────── SHARED demos machine ───────────┐
GH│ webhook(INSTANCE=internal) ─▶ redeploy.sh         │ GH│ webhook(INSTANCE=showcase) ─▶ redeploy.sh│
─▶│                                                   │ ─▶│                                          │
  │  ┌─ edge ──────────────────────────────────────┐ │   │  Traefik (routes ALL examples by labels) │
  │  │ Caddy(TLS) ─┬─▶ helpdesk-internal-app        │ │   │        │                    │            │
  │  │             └─▶ internal-kong ─┐ internal     │ │   │        ▼ (traefik network)  ▼            │
  │  └────────────────────────────────┘ supabase    │ │   │  helpdesk-showcase-app    showcase kong  │
  │       helpdesk.surveyjs.io / supabase.helpdesk…  │ │   │  …other example dockers alongside…       │
  └───────────────────────────────────────────────────┘   └──────────────────────────────────────────┘
```

- **App image:** built per instance from the repo `Dockerfile` (Next.js
  standalone). `NEXT_PUBLIC_*` are **build-time** inlined, so each machine
  builds its own image; runtime secrets are injected as container env.
- **Supabase:** official `supabase/docker` compose, vendored per instance, with
  our app overlay merged on top.
- **Edge — helpdesk machine:** our Caddy (`deploy/proxy/`) terminates TLS and
  routes the two helpdesk domains over a shared external `edge` network.
- **Edge — demos machine:** the showcase joins the shared **Traefik** network
  and declares two routers via labels (app → `helpdesk.demos.surveyjs.io`,
  kong → `supabase.helpdesk.demos.surveyjs.io`); Traefik handles TLS. No host
  ports are published for routing.
- **Auto-deploy:** each machine runs its own `adnanh/webhook` + `redeploy.sh`
  with `INSTANCE` set, deploying only that machine's instance.

---

## 1. Prerequisites (per machine, one time)

On **both** machines (Ubuntu/Debian assumed):

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git webhook openssl
# Supabase CLI (used by redeploy.sh to push migrations):
#   https://supabase.com/docs/guides/cli  (install the static binary)
sudo useradd -m -G docker deploy          # non-root deploy user in the docker group
```

DNS A/AAAA records:

```
# -> dedicated helpdesk machine:
helpdesk.surveyjs.io   supabase.helpdesk.surveyjs.io   deploy.helpdesk.surveyjs.io
# -> shared demos machine (the demos front proxy serves these):
helpdesk.demos.surveyjs.io   supabase.helpdesk.demos.surveyjs.io
```

### 1a. Dedicated helpdesk machine layout

```
/opt/helpdesk/
  src/        # git clone of this repo
  internal/   # vendored supabase compose + .env + docker-compose.app.yml
  proxy/      # our Caddy: Caddyfile + docker-compose.yml
  hooks.json  redeploy.sh   # auto-deploy (INSTANCE=internal)
```

```bash
sudo mkdir -p /opt/helpdesk && sudo chown -R deploy:docker /opt/helpdesk
git clone https://github.com/surveyjs/supabase-helpdesk /opt/helpdesk/src
docker network create edge          # only on the helpdesk machine (for our Caddy)
```

### 1b. Shared demos machine layout

Fit your existing examples convention; e.g. one dir per example:

```
/opt/demos/
  helpdesk/   # src checkout OR vendored supabase compose + .env + overlay + reset-demo.sh + baseline.dump
  …other examples…
```

```bash
sudo mkdir -p /opt/demos/helpdesk && sudo chown -R deploy:docker /opt/demos/helpdesk
git clone https://github.com/surveyjs/supabase-helpdesk /opt/demos/helpdesk/src
```

> No `edge` network here — the showcase integrates with the demos host's
> existing front proxy (§3b). The `ROOT`/dirs in `redeploy.sh` and
> `reset-demo.sh` are overridable; set them to match this layout.

---

## 2. Provision an instance

Same steps on each machine; only the dirs, ports, keys, and domains differ
(the two `.env.example` files already encode distinct ports). Examples below
use the **internal** (helpdesk machine) paths — on the demos machine substitute
`/opt/demos/helpdesk` for the stack dir, `helpdesk-showcase` for the project,
and the showcase `.env.example`.

### 2.1 Vendor the official Supabase compose (pinned)

```bash
cd /opt/helpdesk/internal
git clone --depth 1 --branch <PINNED_TAG> https://github.com/supabase/supabase /tmp/supabase
cp -r /tmp/supabase/docker/* .
cp /opt/helpdesk/src/deploy/internal/docker-compose.app.yml .
cp /opt/helpdesk/src/deploy/internal/.env.example .env
```

> Pin `<PINNED_TAG>` and record it. The app needs `pg_cron`, `pg_net`, and
> `vault`, all present in the Supabase Postgres image — no extra setup.

### 2.2 Generate keys + fill `.env`

```bash
openssl rand -hex 32      # -> JWT_SECRET
openssl rand -hex 32      # -> CRON_SECRET
```

Derive `ANON_KEY` and `SERVICE_ROLE_KEY` from `JWT_SECRET` using the Supabase
key generator (https://supabase.com/docs/guides/self-hosting#api-keys) and paste
all values into `.env`. Set the real domains, `POSTGRES_PASSWORD`, SMTP,
`DASHBOARD_PASSWORD`, and `APP_BUILD_CONTEXT` (the absolute checkout path). On
the **demos machine**, also set the `TRAEFIK_*` vars (§3b) and pick a
`KONG_HTTP_PORT` that doesn't clash with the other examples there.

### 2.3 Bring up the stack

```bash
cd /opt/helpdesk/internal
docker compose -p helpdesk-internal \
  -f docker-compose.yml -f docker-compose.app.yml up -d
```

### 2.4 Apply migrations

```bash
source /opt/helpdesk/internal/.env
( cd /opt/helpdesk/src && supabase db push --include-all \
  --db-url "postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/postgres" )
```

### 2.5 Wire the cron HTTP settings (easy to forget)

The SLA/notification cron jobs call the app via `pg_net`. Set the DB settings:

```bash
cd /opt/helpdesk/internal && source .env
docker compose -p helpdesk-internal exec -T db \
  psql -U postgres -d postgres \
    -v base_url="${NEXT_PUBLIC_APP_URL}" \
    -v cron_secret="${CRON_SECRET}" \
    -f - < /opt/helpdesk/src/deploy/db-settings.sql
```

Verify: `SELECT jobname, schedule FROM cron.job;` should list the SLA, CSAT,
notification-coalescing, and cleanup jobs.

---

## 3. Edge / reverse proxy

### 3a. Helpdesk machine — our Caddy

```bash
mkdir -p /opt/helpdesk/proxy && cd /opt/helpdesk/proxy
cp /opt/helpdesk/src/deploy/proxy/Caddyfile .
cp /opt/helpdesk/src/deploy/proxy/docker-compose.yml .
cp /opt/helpdesk/src/deploy/proxy/.env.example .env
# edit .env: ACME_EMAIL + APP/SUPABASE/DEPLOY_PUBLIC_HOST (the Caddyfile reads
# these via {$VAR}, so it needs no per-machine edits)
docker compose up -d
```

Caddy auto-issues TLS certs once DNS resolves. Browse to `https://helpdesk.surveyjs.io`.

> This app holds customer data — gate it (uncomment the IP allow-list block in
> the Caddyfile, or front it with SSO).

### 3b. Demos machine — integrate with the shared Traefik

The demos host runs **Traefik** in front of all examples. The showcase overlay
ships no proxy; it joins Traefik's network and declares two routers via labels
(in `deploy/showcase/docker-compose.app.yml`):

| Router | Host rule | → service:port |
|---|---|---|
| `helpdesk-demo-app` | `helpdesk.demos.surveyjs.io` | app : 3001 |
| `helpdesk-demo-supabase` | `supabase.helpdesk.demos.surveyjs.io` | kong : 8000 |

Set these in the showcase `.env` (the `Host()` rules and Traefik settings are
all env-driven, so the compose file is the same on every machine):

```
APP_PUBLIC_HOST=helpdesk.demos.surveyjs.io            # app router host
SUPABASE_PUBLIC_HOST=supabase.helpdesk.demos.surveyjs.io  # supabase router host
TRAEFIK_NETWORK=traefik        # the external network Traefik watches (must exist)
TRAEFIK_ENTRYPOINT=websecure   # your TLS entrypoint name
TRAEFIK_CERTRESOLVER=le        # your ACME certresolver name
```

Then `docker compose -p helpdesk-showcase -f docker-compose.yml -f
docker-compose.app.yml up -d` — Traefik auto-discovers the two routers and
issues certs. No host ports are published for routing (kong's official-compose
ports stay bound locally and can be firewalled; public traffic arrives via
Traefik over the docker network).

> Confirm the entrypoint/certresolver names against the demos host's
> `traefik.yml` / static config — they vary per install. If Traefik runs with
> an explicit providers.docker `network`, `TRAEFIK_NETWORK` must match it.

---

## 4. Auto-deploy on GitHub push (per machine)

Each machine runs its own receiver and deploys only its instance. On the
**helpdesk machine** (`INSTANCE=internal`):

```bash
sudo cp /opt/helpdesk/src/deploy/hooks.json  /opt/helpdesk/hooks.json
sudo cp /opt/helpdesk/src/deploy/redeploy.sh /opt/helpdesk/redeploy.sh
sudo chmod +x /opt/helpdesk/redeploy.sh
sudo tee /etc/helpdesk-webhook.env >/dev/null <<EOF
GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)
INSTANCE=internal
EOF
sudo cp /opt/helpdesk/src/deploy/webhook.service /etc/systemd/system/helpdesk-webhook.service
sudo systemctl daemon-reload && sudo systemctl enable --now helpdesk-webhook
```

On the **demos machine** the steps are identical except: paths point at
`/opt/demos/helpdesk`, and `/etc/helpdesk-webhook.env` adds `INSTANCE=showcase`
plus `ROOT=/opt/demos/helpdesk` (so `redeploy.sh` finds the checkout + stack).

In each repo webhook (GitHub → **Settings → Webhooks**):
- Payload URL: that machine's hook, e.g. `https://deploy.helpdesk.surveyjs.io/hooks/redeploy`
- Content type: `application/json`; Secret: the machine's `GITHUB_WEBHOOK_SECRET`; Events: **push only**

On each push to `main`, `redeploy.sh` syncs the checkout, applies new migrations,
rebuilds + recreates that machine's app container, and health-checks it. Change
`DEPLOY_BRANCH` in `redeploy.sh` (and the `refs/heads/main` rule in `hooks.json`)
to deploy a different branch.

---

## 4b. Data durability — internal must never be wiped on deploy

The app container is **stateless** and is rebuilt/recreated on every push — that
is correct. Postgres and Storage are **stateful** and must be fully decoupled
from the deploy lifecycle. Three rules keep the internal instance's data safe;
`redeploy.sh` enforces all three:

1. **Never tear down volumes.** The deploy only does `up -d --build app`. It
   never runs `docker compose down`, never passes `-v`, never `docker volume
   prune`. The `db`/`auth`/`storage`/`kong` services keep running on their
   volumes across deploys.
2. **Forward-only migrations.** `supabase db push` applies only new migrations
   from the history table; existing rows are untouched. **Never** `supabase db
   reset` on internal. The nightly baseline-restore is **showcase-only**
   ([reset-demo.sh](../deploy/showcase/reset-demo.sh)).
3. **Data lives outside the git checkout.** The Supabase stack is in
   `/opt/helpdesk/internal/`; code is in `/opt/helpdesk/src/`. `redeploy.sh`
   only `git reset --hard`s `src/`, so it can't delete the database files.

> **Critical when vendoring the official Supabase compose:** that compose stores
> Postgres data as a **bind mount inside its own directory** (`./volumes/db/...`).
> Confirm the `db` data path resolves under `/opt/helpdesk/internal/volumes`
> (separate from `src/`) — or convert it to a **named Docker volume**. If the DB
> data dir ever sits inside a directory that gets `git clean`/`git reset` or is
> re-cloned, every deploy will erase the database. Verify with `docker volume ls`
> and `docker compose -p helpdesk-internal config | grep -A3 volumes`.

**Wiped-DB guard (automatic).** The internal instance is flagged `guard` in
`redeploy.sh`. Once it has been provisioned and the data is loaded, mark it
initialized:

```bash
touch /opt/helpdesk/internal/.initialized
```

After that marker exists, every deploy first checks the DB is reachable and
actually populated (`public.tickets` is queryable). If the database is missing
or freshly empty (volume wiped), the deploy **aborts before migrating or
starting the app** and logs a loud error — so a misconfiguration fails visibly
instead of silently serving and re-seeding an empty DB. Before the marker
exists (first provision), the guard is skipped. Optionally set
`DB_DATA_VOLUME=<volume name>` in the instance `.env` to also assert the named
volume exists via `docker volume inspect`.

**Pre-migration backup (automatic).** Because the internal instance is flagged
`backup` in `redeploy.sh`, every deploy `pg_dump`s the DB to
`/opt/helpdesk/backups/internal-premigrate-<timestamp>.dump` **before** running
migrations (keeping the newest 14), and aborts the deploy if the dump fails. A
bad or irreversible migration is therefore always recoverable. Write migrations
**expand-then-contract** so a code rollback still runs against the migrated
schema (don't drop a column in the same release that stops using it).

## 5. Landing the Answer Desk data (internal only)

The migration loader (driven by the prompts in [`migration/`](../migration/))
**creates `auth.users` via the Supabase Admin API (preserving UUIDs)**, inserts
`public` rows, and **uploads attachment blobs through the Storage API**. Because
the data spans `auth` + `public` + the storage **file backend**, you cannot just
copy the old Cloud Postgres — a `pg_dump` of `public` would drop every user and
every attachment file.

**Do this instead:** run the loader directly against the internal instance.

1. Stand up the internal instance (§2), migrations applied, cron settings set.
2. **Rehearse first** on a throwaway/local Supabase: point the loader's
   `SUPABASE_URL` + `SERVICE_ROLE_KEY` at it and run. Validate against
   `migration/INSPECTION.md`:
   - counts ≈ 24,787 tickets, 111,330 posts, 8 categories;
   - a depth-3 reply thread renders;
   - a sampled assigned ticket resolves its `agent_id`;
   - custom fields `LicenseStatus` / `Is License Owner` present;
   - an attachment downloads.
3. When validated, run the **same loader once** against the internal production
   instance (`SUPABASE_URL=https://supabase.helpdesk.surveyjs.io`,
   `SERVICE_ROLE_KEY=<internal SERVICE_ROLE_KEY>`) — while it is still private.
4. Keep the Supabase **Cloud** project read-only as reference until the internal
   instance is verified, then decommission it.

_Fallback (only if prod is unreachable from the loader): load locally, then
`pg_dump -Fc -n public -n auth -n storage` **and** copy the storage volume files
into the internal instance. Avoid unless forced._

---

## 6. Showcase nightly reset (demos machine)

Keep the public demo pristine. After first provisioning the showcase instance
(migrations + `supabase/seed.sql` + demo accounts), capture a baseline and
schedule the reset:

```bash
cd /opt/demos/helpdesk
cp src/deploy/showcase/reset-demo.sh . && chmod +x reset-demo.sh
docker compose -p helpdesk-showcase exec -T db \
  pg_dump -U postgres -Fc -n public -n auth -n storage postgres > baseline.dump

sudo crontab -e
# reset-demo.sh defaults INSTANCE_DIR to /opt/demos/helpdesk; override if different.
# 0 4 * * * /opt/demos/helpdesk/reset-demo.sh >> /var/log/helpdesk-demo-reset.log 2>&1
```

This reset lives **only on the demos machine**; the internal helpdesk has no
reset and no `baseline.dump`.

---

## 7. Backups (internal instance — real data)

```bash
# Nightly DB + storage backup (root crontab), keep off-box:
cd /opt/helpdesk/internal
docker compose -p helpdesk-internal exec -T db \
  pg_dump -U postgres -Fc postgres > /backups/internal-$(date +\%F).dump
docker run --rm -v helpdesk-internal_storage:/data -v /backups:/out alpine \
  tar czf /out/internal-storage-$(date +\%F).tgz -C /data .
```

(The storage volume name is `<project>_storage`; confirm with `docker volume ls`.)
Test a restore on a scratch stack periodically.

---

## 8. Two local instances (real-data + example-data)

Run two isolated Supabase stacks on your machine — one loaded with the migrated
Answer Desk data ("real"), one seeded from `supabase/seed.sql` ("example") — and
point a `next dev` server at each. Locally you only need each stack's **Supabase
backend** (the official compose); the app runs via `npm run dev:*` for hot
reload, so you do **not** use our `docker-compose.app.yml` / Caddy / Traefik
overlays here.

### 8.1 Two vendored stacks under `deploy/local/` (gitignored)

The official compose publishes several fixed host ports, so two copies collide
unless each gets its own port block. Each instance is its own directory + its
own vendored copy of the official compose, both under `deploy/local/` (which is
gitignored). Suggested port map (also avoids the `supabase start` test stack on
5432x):

| Var | `deploy/local/real` | `deploy/local/example` |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `hd-real` | `hd-example` |
| `KONG_HTTP_PORT` | `8000` | `8100` |
| `KONG_HTTPS_PORT` | `8443` | `8543` |
| `POSTGRES_PORT` | `5500` | `5501` |
| `POOLER_PROXY_PORT_TRANSACTION` | `6500` | `6501` |
| `API_EXTERNAL_URL` / `SUPABASE_PUBLIC_URL` | `http://127.0.0.1:8000` | `http://127.0.0.1:8100` |
| `SITE_URL` | `http://127.0.0.1:3001` | `http://127.0.0.1:3002` |

**Adding `real` by cloning your existing `example`** (fastest — guarantees the
same compose + keys, only ports/data change):

```bash
cp -r deploy/local/example deploy/local/real
cd deploy/local/real

# 1. Edit .env: set the `real` column above (project name, all *_PORT vars, URLs).
# 2. Start from an EMPTY database — drop any DB data copied from example:
#    - named volumes: fresh automatically once COMPOSE_PROJECT_NAME changed
#    - bind-mounted data (e.g. ./volumes/db/data): delete it so it re-initialises
rm -rf ./volumes/db/data 2>/dev/null || true

docker compose -p hd-real up -d
```

> If your vendored compose hardcodes any other published port (e.g. analytics
> `4000`), change it in the `real` copy too. Disable email confirmation (or use
> the bundled Inbucket) for painless local signups.

### 8.2 Load data into each

```bash
# Migrations into both (DB url uses each stack's POSTGRES_PORT):
( cd /path/to/repo && supabase db push --include-all \
    --db-url "postgresql://postgres:<pw>@127.0.0.1:5500/postgres" )   # real
( cd /path/to/repo && supabase db push --include-all \
    --db-url "postgresql://postgres:<pw>@127.0.0.1:5501/postgres" )   # example

# Example instance: seed it.
psql "postgresql://postgres:<pw>@127.0.0.1:5501/postgres" -f supabase/seed.sql

# Real instance: run the Answer Desk migration loader at it (the §5 rehearsal),
# SUPABASE_URL=http://127.0.0.1:8000 + that stack's SERVICE_ROLE_KEY.
```

### 8.3 Run the app against each

Copy the example env files and fill in each stack's keys (the official compose
demo defaults), then run — they use different ports so both can run at once:

```bash
cp .env.internal.local.example .env.internal.local   # -> 127.0.0.1:8000, app :3001
cp .env.demo.local.example     .env.demo.local       # -> 127.0.0.1:8100, app :3002
npm run dev:internal    # real-data app    on http://127.0.0.1:3001
npm run dev:demo        # example-data app on http://127.0.0.1:3002
```

### 8.4 Env-file cheat sheet

| File (gitignored unless noted) | Script | Backend |
|---|---|---|
| `.env.test` *(committed)* | `npm run dev:local` | `supabase start` Docker — used by tests |
| `.env.internal.local` | `npm run dev:internal` | local **real-data** stack (`127.0.0.1:8000`) |
| `.env.demo.local` | `npm run dev:demo` | local **example-data** stack (`127.0.0.1:8100`) |
| `.env.local` | `npm run dev` | your personal default (point at the local container) |

- **`.env.test` vs `.env.local`** — keep them separate. `.env.test` is committed
  with deterministic local-container keys (tests rely on it); never put real
  secrets there. So **don't replace `.env.local` with `.env.test`** — instead
  point `.env.local` at the local container so a bare `npm run dev` is safe.
- `.env*.local` files are gitignored; their `*.example` versions are committed.
- The two stacks are independent of the `supabase start` test stack — if you hit
  port limits or RAM pressure, stop `supabase start` while running them.
- To point an env file at the **remote** servers instead of local, swap the URL
  + keys (⚠ `helpdesk.surveyjs.io` is live production data).

---

## 9. Decommissioning Vercel + Supabase Cloud

Vercel + Supabase Cloud was only ever the **dev/demo backend** for this app —
not the source of the Answer Desk migration (that's the local CSVs in
`migration/`) and not the live internal helptracker. Once the self-hosted demo
is up (it is — `helpdesk.demos.surveyjs.io`), it's redundant. Before tearing it
down, confirm two things:

1. Nobody is actively using the old Vercel URL as a working instance (point them
   at the self-hosted demo first).
2. There's no config/data living only in Cloud that you want to keep.

Then:

```bash
# 1. Final archival snapshot (just in case):
supabase db dump --db-url "<cloud db url>" -f cloud-final-$(date +%F).sql

# 2. Vercel: delete the project / disconnect the GitHub integration in the
#    Vercel dashboard. Stops auto-deploys and any Vercel Cron.

# 3. Supabase Cloud: unlink locally so no stray `db push` targets Cloud, then
#    pause and later delete the project in the Supabase dashboard.
supabase unlink
```

Repo-side cleanup is already done: there was no Vercel/Cloud binding in code
(the leftover `public/vercel.svg` has been removed). After decommissioning,
scrub the stale Cloud credentials from your `.env.local` (the
`csyflfpzgzmcrizwegfy.supabase.co` URL, anon/service keys, and
`SUPABASE_ACCESS_TOKEN`) and repoint it at the local container.

---

## 10. Verification checklist

- [ ] App reachable over HTTPS; `/api/health` returns `{"status":"ok"}` (both machines).
- [ ] Sign up / log in works (GoTrue SMTP sends the confirmation/reset email).
- [ ] Create a ticket; agent dashboard updates live (Realtime).
- [ ] `POST /api/cron/sla` with `Authorization: Bearer <CRON_SECRET>` returns 200;
      `cron.job` rows exist and app logs show pg_net cron hits.
- [ ] AI key saved in Admin → AI is stored (Vault) and used.
- [ ] Push a trivial commit → each machine's webhook fires → its container rebuilds + stays healthy.
- [ ] Demos machine: Traefik discovers both routers (app + supabase) and serves them with TLS.
- [ ] Migration rehearsal counts/spot-checks pass before the production load.
- [ ] internal vs showcase: separate machines, DBs, keys, volumes; showcase reset runs, internal does not.

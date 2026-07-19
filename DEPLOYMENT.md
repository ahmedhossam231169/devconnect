# DevConnect — deploying to a fresh VPS

A complete, copy-paste runbook to take DevConnect from an empty Ubuntu server to a
live HTTPS site on your own domain. Every command is meant to be run in order.

If you follow this, the only things that remain *yours* to do are the accounts you
have to own personally — renting the server, buying the domain, and registering the
OAuth apps. Those are called out explicitly in [§16](#16-what-only-you-can-do).

---

## The architecture you're building

```
                              your-domain.com
                                     │  (HTTPS, port 443)
                                     ▼
                        ┌────────────────────────┐
   Browser ───────────► │  nginx  (TLS, on VPS)   │
                        │                         │
                        │  /            → static client build (dist/)
                        │  /api         → 127.0.0.1:4000  (Docker: app)
                        │  /socket.io   → 127.0.0.1:4000  (websockets)
                        └────────────────────────┘
                                     │
                        ┌────────────┴────────────┐
                        │  Docker Compose          │
                        │   app  ── migrate ── db  │   (db optional — see §6)
                        └─────────────────────────┘
                                     │
                              Postgres (Neon, managed)  ← recommended
```

**Why one domain matters (this is not cosmetic).** The client and API are served
from the **same origin** — the client at `https://your-domain.com`, the API under
`https://your-domain.com/api`. The refresh-token cookie is therefore **first-party**.
If instead you split them across two hosts (the old Vercel + Render setup), that
cookie becomes third-party, and **Safari blocks it by default** — those users get
silently logged out every 15 minutes. Serving both from one domain removes the
problem entirely, with no code change. This is the fix for the issue tracked as #31.

---

## 1. Prerequisites — have these before you start

| Thing | Notes |
|---|---|
| A VPS | Ubuntu 22.04 or 24.04, 1 vCPU / 1 GB RAM is enough for an MVP (2 GB comfortable). Hetzner, DigitalOcean, Vultr, Linode all fine. |
| A domain | e.g. `devconnect.app`. You'll point it at the VPS in §11. |
| A managed Postgres | **Neon** (neon.tech) free tier is ideal — see §6. Or run Postgres in the compose stack. |
| A Cloudinary account | cloudinary.com, free tier. For image/file uploads. |
| GitHub + Google OAuth apps | **Required** — see §13. Email/password sign-up is restricted to `@devconnect.com`, so OAuth is the *only* way the public can register. |
| SMTP (optional) | For password-reset emails. brevo.com gives 300/day free. Without it, reset links are printed to the server log instead of sent. |

---

## 2. First login and a non-root user

SSH in as root, then create a normal user with sudo — you shouldn't run services as root.

```bash
ssh root@YOUR_SERVER_IP

adduser deploy
usermod -aG sudo deploy

# copy your SSH key so you can log in as the new user
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy/

# from now on, log in as deploy
exit
ssh deploy@YOUR_SERVER_IP
```

## 3. Firewall — only open what you serve

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp     # HTTP (certbot + redirect to HTTPS)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
sudo ufw status
```

Note: the API's port 4000 is **not** opened. It's only reachable from nginx on
localhost, never from the internet directly.

## 4. Install Docker + Docker Compose

```bash
# Docker's official install script
curl -fsSL https://get.docker.com | sudo sh

# run docker without sudo (log out/in afterwards for it to take effect)
sudo usermod -aG docker $USER
newgrp docker

docker --version
docker compose version
```

## 5. Get the code

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/ahmedhossam231169/LoopIn.git
cd LoopIn
```

For updates later, see [§14](#14-deploying-an-update).

---

## 6. Choose your database

**Recommended: Neon (managed).** You don't run or back up Postgres yourself, it's
already pooled, and it survives your VPS being rebuilt.

1. Create a project at neon.tech, in a region near your VPS.
2. Copy **two** connection strings:
   - The **pooled** one (host contains `-pooler`) → `DATABASE_URL`
   - The **direct** one (same host **without** `-pooler`) → `DIRECT_DATABASE_URL`
   - The split matters: Prisma's migrations need a direct connection, because the
     pooler (PgBouncer in transaction mode) breaks the advisory locks migrations rely on.
3. In §7 you'll paste these into `server/.env`. Since you don't need a local Postgres,
   **edit `docker-compose.yml`**: comment out the `db` and `migrate` services *and* the
   `depends_on:` block inside the `app` service (otherwise `docker compose up app` would
   still pull the local db up as a dependency). Then follow the Neon path in §8.

**Alternative: Postgres in the compose stack.** Simpler to start, but now *you* own
its backups (§15) and it dies with the VPS. If you go this way, keep the `db` and
`migrate` services and point `DATABASE_URL`/`DIRECT_DATABASE_URL` at `db:5432` (the
compose file already does this via its `environment:` block).

---

## 7. Configure secrets

```bash
cp server/.env.example server/.env
nano server/.env
```

Fill it in. The **required in production** values — the server refuses to boot without
them, and rejects `localhost`:

```ini
# --- Database (from §6) ---
DATABASE_URL="postgresql://…-pooler…/devconnect"
DIRECT_DATABASE_URL="postgresql://…(no -pooler)…/devconnect"

# --- Security ---
# generate a real one — do not reuse this line:
JWT_SECRET="$(openssl rand -base64 48)"

# --- URLs: SAME domain for both (see §the architecture) ---
CLIENT_URL="https://your-domain.com"
SERVER_URL="https://your-domain.com"

# nginx is the one proxy in front of the app
TRUST_PROXY="1"

# --- At least ONE OAuth provider is required (see §13) ---
GITHUB_CLIENT_ID="…"
GITHUB_CLIENT_SECRET="…"
GOOGLE_CLIENT_ID="…"
GOOGLE_CLIENT_SECRET="…"

# --- Uploads (see §1) ---
CLOUDINARY_CLOUD_NAME="your-cloud-name"

# --- Optional but recommended ---
GITHUB_TOKEN="…"          # lifts GitHub API rate limit 60→5000/hr
SMTP_HOST="…"             # without SMTP, reset links print to the log
SMTP_USER="…"
SMTP_PASS="…"
SMTP_FROM="DevConnect <no-reply@your-domain.com>"

# leave EMAIL_DISABLED empty in production
```

> Generate `JWT_SECRET` with `openssl rand -base64 48` and paste the result — don't
> ship the literal example. `server/.env` is gitignored and must **never** be committed.

---

## 8. Build and start the API

```bash
# builds the image, applies migrations (migrate service), then starts the app
docker compose up -d --build

# watch it come up
docker compose logs -f app
```

You're looking for `🚀 DevConnect API + WebSocket running`. The `migrate` service runs
`prisma migrate deploy` first and exits; the `app` waits for it to finish and for the
DB healthcheck before starting.

**If you're on Neon** (no local db): start only the app, and run migrations from it —

```bash
# migrations
docker compose run --rm app npx prisma migrate deploy
# then the app alone (no db/migrate services)
docker compose up -d --build app
```

Confirm it's healthy (from the VPS itself — the port isn't public):

```bash
curl -s http://localhost:4000/api/livez     # {"ok":true,"status":"alive",…}
curl -s http://localhost:4000/api/readyz     # {"ok":true,…} once the DB is reachable
```

---

## 9. Build the client

The client is a static Vite build. Build it once and let nginx serve the files.

```bash
# install Node 22 (matches the API and CI)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

cd client
cp .env.example .env
nano .env
```

Set the client env. Because the API is now **same-origin**, leave `VITE_API_URL`
empty — requests then go to `/api` on the same domain, which nginx routes to the
container:

```ini
VITE_API_URL=""
VITE_CLOUDINARY_CLOUD_NAME="your-cloud-name"
VITE_CLOUDINARY_UPLOAD_PRESET="your-unsigned-preset"
```

> `VITE_*` values are baked in **at build time**, not read at runtime. If you change
> them, you must rebuild.

```bash
npm ci
npm run build          # outputs client/dist
cd ..
```

---

## 10. nginx — serve the client, proxy the API

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/devconnect
```

Paste this, replacing `your-domain.com` and the `root` path:

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # the built client
    root /home/deploy/LoopIn/client/dist;
    index index.html;

    # SPA: unknown paths fall back to index.html so client-side routing works
    location / {
        try_files $uri $uri/ /index.html;
    }

    # REST API → the Docker app on localhost
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        # the app's rate limiting and secure-cookie logic depend on these:
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # websockets (socket.io) need the Upgrade dance
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # long-poll fallback can hold the connection a while
        proxy_read_timeout 90s;
    }

    # uploaded bodies: the app caps JSON at 1mb; give a little headroom
    client_max_body_size 2m;
}
```

`TRUST_PROXY=1` in `server/.env` **must** match this single nginx hop. If you later
put Cloudflare in front, it becomes two hops → set `TRUST_PROXY=2`, or the rate
limiter can be bypassed (this is the BUG-06 concern).

Enable it and reload:

```bash
sudo ln -s /etc/nginx/sites-available/devconnect /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # test the config
sudo systemctl reload nginx
```

---

## 11. DNS — point the domain at the VPS

At your domain registrar, add two **A records** to your server's IP:

| Type | Name | Value |
|---|---|---|
| A | `@` | `YOUR_SERVER_IP` |
| A | `www` | `YOUR_SERVER_IP` |

Wait for it to propagate (`dig +short your-domain.com` should return your IP).

## 12. TLS — free HTTPS with certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Certbot edits the nginx config to add the certificate and an HTTP→HTTPS redirect, and
sets up **automatic renewal** (verify with `sudo certbot renew --dry-run`).

Now `https://your-domain.com` serves the app. The secure refresh cookie works because
TLS terminates here and the app marks the cookie `Secure` in production.

---

## 13. OAuth callback URLs — the last wiring

Both providers must send users back to **your** `SERVER_URL`. Register these apps
(this is §the "only you" list too):

**GitHub** — github.com/settings/developers → New OAuth App:
- Homepage URL: `https://your-domain.com`
- Authorization callback URL: `https://your-domain.com/api/auth/github/callback`

**Google** — console.cloud.google.com → Credentials → OAuth client ID (Web):
- Authorized redirect URI: `https://your-domain.com/api/auth/google/callback`

Paste the resulting client IDs/secrets into `server/.env`, then restart the API:

```bash
docker compose up -d app        # picks up the new env
```

---

## Verify the whole thing

```bash
curl -s https://your-domain.com/api/livez            # alive
curl -s https://your-domain.com/api/readyz            # ready (DB reachable)
```

Then in a browser: open `https://your-domain.com`, sign in with GitHub or Google,
and confirm you land in the app. In DevTools → Application → Cookies you should see
`devconnect_refresh` marked **HttpOnly** and **Secure**; `localStorage` holds no token.

### Grant yourself admin (for the moderation queue)

Sign up first (so your user row exists), then flip the `isAdmin` flag directly in the
database. The `npm run admin:grant` helper needs `tsx` and the `scripts/` source, which
the production image deliberately doesn't ship — so in production, do it with SQL:

**On Neon** — paste into the Neon SQL editor (or `psql "$DIRECT_DATABASE_URL"`):

```sql
UPDATE "User" SET "isAdmin" = true WHERE username = 'YOUR_USERNAME';
```

**On the compose Postgres:**

```bash
docker compose exec db psql -U devconnect devconnect \
  -c "UPDATE \"User\" SET \"isAdmin\" = true WHERE username = 'YOUR_USERNAME';"
```

(The `npm run admin:grant -- YOUR_USERNAME` / `admin:list` / `admin:revoke` scripts are
for a local dev checkout, where `tsx` is present.)

---

## 14. Deploying an update

```bash
cd ~/LoopIn
git pull

# API: rebuild + re-run migrations + restart
docker compose up -d --build      # (Neon: add `docker compose run --rm app npx prisma migrate deploy` first)

# client: rebuild the static files, then reload nginx
cd client && npm ci && npm run build && cd ..
sudo systemctl reload nginx
```

The API drains gracefully on restart (SIGTERM → readiness 503 → finish in-flight
requests → exit), so a redeploy doesn't drop live requests or socket messages.

---

## 15. Backups

**On Neon:** point-in-time restore and branching are built in — nothing to do, but
know where the restore button is.

**If you run the compose Postgres:** back it up yourself. A daily `pg_dump`:

```bash
# create the script
cat > ~/backup-db.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F-%H%M)
mkdir -p ~/backups
docker compose -f ~/LoopIn/docker-compose.yml exec -T db \
  pg_dump -U devconnect devconnect | gzip > ~/backups/devconnect-$STAMP.sql.gz
# keep 14 days
find ~/backups -name '*.sql.gz' -mtime +14 -delete
SH
chmod +x ~/backup-db.sh

# run it daily at 03:30 via cron
(crontab -l 2>/dev/null; echo "30 3 * * * ~/backup-db.sh") | crontab -
```

**Test the restore at least once** — an untested backup isn't a backup:

```bash
gunzip -c ~/backups/devconnect-SOMEDATE.sql.gz | \
  docker compose exec -T db psql -U devconnect devconnect
```

---

## 16. What only you can do

Everything above is scripted. These are the things tied to accounts you personally
own — no one can do them for you:

1. **Rent the VPS** and note its IP.
2. **Buy the domain** and set its A records (§11).
3. **Provision the database** — create the Neon project and copy both URLs (§6).
4. **Register the OAuth apps** — GitHub + Google, with callback URLs pointing at your
   `SERVER_URL` (§13). Without at least one, the public cannot sign up at all.
5. **Set the real secrets** in `server/.env` — a fresh `JWT_SECRET`, the OAuth
   credentials, Cloudinary cloud name, and SMTP if you want reset emails delivered.
6. **Grant the first admin** once you've signed in (§Verify).

Once these are in place, `docker compose up -d --build` + the nginx/certbot steps are
the entire deploy, and updates are `git pull` + rebuild.

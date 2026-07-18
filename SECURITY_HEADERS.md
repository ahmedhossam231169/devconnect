# Dependency & HTTP header review (task #15)

Reviewed 2026-07-18 against the running server, not against documentation —
every header below was captured from an actual response.

---

## 1. Dependencies

| Project | `npm audit` | Verdict |
|---|---|---|
| `server/` (prod deps) | **0 vulnerabilities** | Clean |
| `server/` (incl. dev) | **0 vulnerabilities** | Clean |
| `client/` | 1 high, 1 moderate | **Dev-only — see below** |

### The client findings do not reach production

All of them are in `vite`, a `devDependency`, and all affect the **dev server**
— not the static bundle `vite build` emits. Vite is not part of the deployed
artifact, so no end user is exposed.

| Advisory | Affects |
|---|---|
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — esbuild: any website can request the dev server and read the response | dev server |
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) — Vite path traversal in optimized-deps `.map` handling | dev server |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) — `server.fs.deny` bypass on Windows alternate paths | dev server, Windows |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) — launch-editor NTLMv2 hash disclosure via UNC paths | dev server, **Windows** |

**One of these is worth your attention now:** the launch-editor NTLM issue is
Windows-specific and you develop on Windows 11. While `npm run dev` is running,
a malicious page you visit in the same browser could cause your NTLMv2 hash to
be disclosed. Practical mitigation until it's fixed: don't browse untrusted
sites while the dev server is up.

**Not fixed here, deliberately.** The only fix `npm audit` offers is
`vite@8.1.5` — three major versions up from the pinned `^5.4.11`, flagged
`isSemVerMajor`. There is no patch in the 5.x line. Upgrading the client build
toolchain by three majors is a change that needs its own branch and a full
client regression pass; doing it silently inside a backend security commit
risks breaking the build for a vulnerability that cannot reach production.
Tracked as **task #34**.

### Runtime version

`server/package.json` declares `"engines": { "node": "22.x" }`, but the local
runtime is **v26.5.0**. `engines` is advisory unless `engine-strict=true`, so
nothing is enforcing it — you are developing on 26 and would deploy on 22.
Behavioural differences would not surface until production. Tracked as **#35**.

---

## 2. Response headers (captured live)

`helmet()` runs with defaults. Everything below is what a real response carries:

```
Content-Security-Policy: default-src 'self';base-uri 'self';font-src 'self' https: data:;
  form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';
  script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';
  upgrade-insecure-requests
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Frame-Options: SAMEORIGIN
X-Permitted-Cross-Domain-Policies: none
X-XSS-Protection: 0
Vary: Origin
Cache-Control: no-store        ← added by this task
```

`X-Powered-By: Express` is **absent** — helmet strips it, so the framework
isn't advertised.

### What was changed

**`Cache-Control: no-store` on every `/api` response.** This was a real gap.
Responses had only an `ETag` and no cache directive, so browsers fall back to
*heuristic* caching: `/api/auth/me` — email, username, profile — could be
written to the browser's on-disk cache and re-read after logout, by another
user of the same machine, or stored by an intermediary proxy. No response this
API serves is public or static, so `no-store` is correct everywhere, health
checks included (a cached health check is meaningless).

### What was deliberately left alone, and why

Each of these was flagged as "review" in the original task. Reviewing them
concluded the default is already right — recorded so the reasoning isn't
re-litigated later:

- **`Cross-Origin-Resource-Policy: same-origin`** — the original note worried
  this might break a cross-origin SPA. It does not: CORP is enforced only for
  `no-cors` subresource requests, and the SPA calls this API with credentialed
  CORS `fetch`, which CORP does not gate. Keeping it prevents API responses
  being pulled in as `<img>`/`<script>` subresources from other origins. Keep.
- **HSTS `max-age=31536000; includeSubDomains`** — correct once TLS terminates
  at nginx. Browsers ignore HSTS over plain HTTP, so it is inert in local dev
  rather than harmful. `preload` is *not* set, which is right: preloading is
  effectively irreversible and shouldn't be opted into casually. Keep.
- **CSP on a JSON API** — mostly inert, since the API renders no HTML. Kept
  anyway because it costs ~250 bytes and will matter the moment the API serves
  HTML, which task #23 (Swagger UI at `/api/docs`) will do.
- **`X-Frame-Options: SAMEORIGIN`** — `DENY` is marginally tighter for a pure
  API, but the API serves no framable content today, and #23 would want its
  docs page framable same-origin. No practical difference. Keep.

---

## 3. CORS — verified by request, not by reading config

`origin` is the exact allowlist from `CLIENT_URL` (`lib/cors.ts` → `config.allowedOrigins`).

| Test | Result |
|---|---|
| Allowed origin (`http://localhost:5173`) | `Access-Control-Allow-Origin: http://localhost:5173` ✓ |
| **Unknown origin (`https://evil.com`)** | **no `Access-Control-Allow-Origin`** — rejected, *not* reflected ✓ |
| Preflight from unknown origin for `X-Requested-With` | no `Access-Control-Allow-Origin` → browser blocks ✓ |
| Preflight from allowed origin | `Access-Control-Allow-Origin` present ✓ |
| `Vary: Origin` | present — caches can't cross-serve a CORS decision ✓ |

The unknown-origin case is the one that matters, and it behaves correctly:
the origin is never echoed back, so a credentialed cross-origin read is
impossible.

**This is also what makes the CSRF defence hold.** `/api/auth/refresh` and
`/api/auth/logout` require `X-Requested-With: devconnect`. That is not a
CORS-safelisted header, so the browser must preflight it; the preflight from a
foreign origin gets no `Access-Control-Allow-Origin` and the real request is
never sent. A request without the header is rejected at the route with 403
(covered by `refresh.spec.ts`).

One cosmetic note: `Access-Control-Allow-Credentials: true` is emitted even for
rejected origins. It is inert without `Access-Control-Allow-Origin` — browsers
require both — so this is noise, not a finding.

### Body size limit

`express.json({ limit: "1mb" })` bounds request bodies, so an oversized payload
can't be used to exhaust memory. Adequate; the largest legitimate body is a
10 KB code snippet.

---

## 4. Follow-ups this review opened

| # | Item | Why it isn't done here |
|---|---|---|
| 34 | Upgrade `vite` 5 → 8 in the client | Three-major build-tool upgrade; needs its own branch + client regression. Dev-only exposure. |
| 35 | Reconcile Node version (`engines` 22.x vs local v26.5.0) | Needs your decision on which version is the target. |
| 14 | Add `npm audit` to CI | CI doesn't exist yet; belongs with that task. |

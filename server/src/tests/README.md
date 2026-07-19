# Tests

## Running them

```bash
TEST_DATABASE_URL="postgresql://..." npm test
```

`TEST_DATABASE_URL` is **required and has no fallback**. The suite creates
users, revokes sessions and mutates rows, so it refuses to guess which
database to use — a fallback to `DATABASE_URL` is exactly how a test run ends
up writing to production. Point it at a dev database or (better) a throwaway
Neon branch.

`src/tests/setup.ts` also forces `EMAIL_DISABLED=1`. That isn't tidiness: the
suites hit `forgot-password` dozens of times, and with real SMTP credentials
present that sent real mail to addresses that don't exist, burning send quota
and generating bounces that damage sender reputation. It happened.

## Layout

`*.test.ts` — Vitest. Mount the Express app in-process via supertest, so no
server on a fixed port is needed and they run in CI.

`*.spec.ts` — the older hand-rolled scripts, run with `tsx` against a live
server. Vitest deliberately ignores them (see `vitest.config.ts`).

## Why tests run sequentially

`fileParallelism: false` is a correctness requirement, not a performance
oversight. The suites share one database and process-global state — rate-limit
counters and the per-account login lock. Run in parallel, one suite eats the
IP's request budget and the next gets a 429, so tests fail in alternation for
reasons that have nothing to do with the code under test.

Every request also carries a unique `X-Forwarded-For` (see `helpers.ts`). The
`authLimiter` allows 10 auth requests per IP per 15 minutes; without per-request
IPs the eleventh request onwards gets a uniform, fast 429 — which silently
turned a timing test green while it was measuring nothing at all.

## Ported (8 files, 91 tests)

| File | Guards |
|---|---|
| `security.test.ts` | BUG-01…05 + JWT integrity |
| `refresh.test.ts` | session rotation, reuse detection, per-device revocation |
| `admin.test.ts` | moderation review surface, admin gating |
| `upload-host.test.ts` | BUG-11 upload host allowlist |
| `email-header.test.ts` | BUG-08 email header injection |
| `headers-cors.test.ts` | security headers, CORS, CSRF chain, body limits |
| `login-throttle.test.ts` | BUG-06 per-account brute-force lock |
| `socket-broadcast.test.ts` | BUG-10 real-time broadcast scoping |

`socket-broadcast` is the one that still needs a real server — socket.io needs a
live connection — so it starts one on an ephemeral port rather than a fixed one.

## Not yet ported

| File | Why |
|---|---|
| `auth.spec.ts`, `chat.spec.ts`, `communities.spec.ts`, `talent.spec.ts` | Feature-behaviour scripts predating this audit. Worth porting; no security regression depends on them. |
| `forgot-password-timing.spec.ts` | Measures wall-clock timing over ~50 samples. Kept as a manual diagnostic — timing assertions inside a test runner are flaky and would produce noisy CI failures. |
| `shutdown.spec.ts` | Spawns the server as a child process and sends SIGTERM, so it can't run in-process. Also can't be fully exercised on Windows (no POSIX signals). |

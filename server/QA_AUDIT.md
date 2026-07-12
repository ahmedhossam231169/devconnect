# DevConnect — QA & Security Audit

**Scope:** Full backend (Express + Prisma + Socket.io + Zod + JWT) and the client's XSS-relevant rendering.
**Method:** Static source review of every route, middleware, schema, lib, and the socket layer, plus authored executable tests. No code changed except added test files.
**DB execution:** Not run yet — `DATABASE_URL` targets a real Postgres and no server/DB was running. Executable proof is in `src/tests/security.spec.ts` (see "How to run" at the bottom).

---

## 1. Test plan (prioritized)

| # | Feature area | Test case | Type | Severity |
|---|---|---|---|---|
| 1 | Auth / register | Self-assign `role: RECRUITER` → gains talent PII access | Authorization / mass-assignment | **High** |
| 2 | Posts / private communities | Outsider reads comments/reactions/reposts of a private-community post by id | Access control (IDOR) | **High** |
| 3 | Posts / private communities | Outsider likes/comments/reposts a private-community post | Access control | **High** |
| 4 | Communities | Non-member reads `/communities/:slug/members` full roster | Info disclosure | Medium |
| 5 | Communities | Non-member sees `memberPreview` on private community detail | Info disclosure | Medium |
| 6 | Moderation / block | Blocked user still reads blocker's profile, posts, search results | Access control | Medium |
| 7 | Auth / session | Password reset does not invalidate existing JWTs | Session mgmt | Medium |
| 8 | Infra / rate limit | `trust proxy:1` + IP limiter → spoofable `X-Forwarded-For` if no real proxy | Misconfiguration | Medium |
| 9 | Auth / forgot | Response body identical, but timing differs → user enumeration | Info disclosure | Low |
| 10 | Messaging email | Offline-email **subject** uses unescaped displayName | Injection (mitigated by nodemailer) | Low |
| 11 | Feed | Loads ≤600 rows to memory + sorts per request (no keyset paging) | DoS / scaling | Low |
| 12 | Auth JWT | Tampered / missing / expired token rejected | Auth (control) | — pass |
| 13 | Talent | `DEVELOPER` blocked from recruiter routes | Authorization (control) | — pass |
| 14 | Conversations | Non-participant read (REST) + send (socket) → FORBIDDEN | Access control (control) | — pass |
| 15 | Notifications | Mark another user's notification read → 404 | IDOR (control) | — pass |
| 16 | XSS | `javascript:`/`data:` URL in avatar/website/image rejected; markdown/code escape | Injection (control) | — pass |
| 17 | Data exposure | `passwordHash` never in any response | Sensitive data (control) | — pass |
| 18 | Injection | Search/talent `q` via Prisma params → no SQLi | Injection (control) | — pass |
| 19 | OAuth | CSRF `state` cookie + `timingSafeEqual`; GitHub email not auto-linked | CSRF/takeover (control) | — pass |
| 20 | Validation | Empty/oversized/wrong-type bodies → 422 with Zod details | Input validation (control) | — pass |

Each area was also reviewed for happy-path, edge (empty / max-length / unicode-Arabic / oversized) and negative inputs; Zod schemas enforce max lengths (post body 5000, snippet 10000, comment 2000, quote 500) and `express.json({ limit: "1mb" })` caps payloads.

---

## 2. Bug reports

### BUG-01 — Any user can self-assign the RECRUITER role (bulk PII access) · **HIGH**
- **Affected:** `src/schemas/auth.ts:14`, `src/routes/auth.ts:79`; privileged consumer `src/routes/talent.ts:10-11`, `src/routes/shortlist.ts:11`.
- **Steps to reproduce:** `POST /api/auth/register` with `{ ..., "role": "RECRUITER" }` → then `GET /api/talent/search`.
- **Expected:** Recruiter privilege is not grantable from client input; talent search restricted to vetted recruiters.
- **Actual:** `registerSchema` accepts `role: z.enum(["DEVELOPER","RECRUITER"])` straight from the body. The account immediately passes `requireRole("RECRUITER")` and can enumerate every developer's `displayName, location, yearsExperience, specialty, availability, skills` — including devs marked `NOT_LOOKING`, with no opt-in and no way to opt out.
- **Suggested fix:** Drop `role` from `registerSchema` (default everyone to `DEVELOPER`). Provision recruiter accounts through a separate, verified flow (invite/admin/domain check). If open recruiter signup is intentional, at minimum gate discoverability behind a per-profile "visible to recruiters" opt-in and verify recruiter identity.
- **✅ FIXED (opt-in approach):** Recruiter self-signup stays open by product choice; the data-exposure harm is closed with a consent gate. Added `Profile.discoverable Boolean @default(false)` (`prisma/schema.prisma`); `GET /api/talent/search` now always filters `{ discoverable: true }` (`routes/talent.ts`), so non-consenting developers are never enumerable. Exposed the flag through `updateProfileSchema` + `GET /api/profiles/me`, and added a "Discoverable by recruiters" toggle on the Edit Profile page (`client/src/pages/EditProfile.tsx`). Verified: `security.spec.ts` BUG-01 block now 4/4 PASS (non-opted devs absent, opted-in dev present, opting one in doesn't expose others); UI round-trip confirmed in the browser (toggle persists). **Production step:** apply the schema change to the real DB (`npx prisma db push`, or create a migration `prisma migrate dev --name add_profile_discoverable`) before deploy.

### BUG-02 — Private-community post sub-resources bypass the visibility gate (IDOR) · **HIGH**
- **Affected:** `src/routes/posts.ts` — `GET /:id/comments` (323), `GET /:id/reactions` (568), `GET /:id/reposts` (295), `POST /:id/like` (199), `POST /:id/comments` (349), `POST /:id/repost` (251).
- **Steps to reproduce:** Owner posts in a **private** community. A non-member with the post id calls `GET /api/posts/:id/comments` (200, leaks content) and `POST /api/posts/:id/like` / `.../comments` (succeed).
- **Expected:** Same protection as the permalink `GET /api/posts/:id`, which correctly applies `communityVisibility()` (`posts.ts:187`) and returns 404 to non-members.
- **Actual:** The sub-resource handlers only check `assertNotBlocked` (or nothing). Membership/visibility is never verified, so private-community discussion, reactor lists, and reposter lists leak, and outsiders can inject likes/comments (also generating notifications to the author).
- **Why it matters:** cuids aren't secret — they appear in notification links, share URLs, and are retained by ex-members. Defeats the core "private community" guarantee.
- **Suggested fix:** Add a shared guard: load the post's `communityId`, and for every read/write sub-resource resolve it through `communityVisibility(viewerId)` (reads) or an explicit membership check (writes), returning 404/403 for non-members — mirror the permalink handler.
- **✅ FIXED:** Added `assertPostVisible(postId, viewerId)` (`routes/posts.ts`) which reuses `communityVisibility()` and throws 404 when the post isn't visible. The three GET sub-resources (`/comments`, `/reactions`, `/reposts`) call it up front; the write handlers (`/like`, `/comments`, `/repost`) changed their `findUnique` to `findFirst({ where: { id, ...communityVisibility(viewerId) } })`, so non-members get 404. Verified: `security.spec.ts` BUG-02 block now 8/8 PASS — outsider blocked on all six endpoints, and members can still read/like the private post; `communities.spec` (public-post like) still green.

### BUG-03 — Private community roster & preview exposed to non-members · **MEDIUM**
- **Affected:** `src/routes/communities.ts:334` (`GET /:slug/members`, no membership check at all) and `:87` (`GET /:slug` returns `memberCount` + `memberPreview` regardless of privacy).
- **Steps to reproduce:** Non-member calls `GET /api/communities/<private-slug>/members` → full username/displayName/avatar/role list.
- **Expected:** For `isPrivate` communities, roster and previews are members-only (consistent with `/:slug/posts`, which *does* check).
- **Actual:** No privacy check on these two endpoints.
- **Suggested fix:** In both handlers, if `community.isPrivate` and the caller has no `CommunityMember` row, omit the roster/preview (return counts only or 403), matching the posts endpoint.
- **✅ FIXED:** `GET /:slug/members` now returns 403 to non-members of a private community; `GET /:slug` returns an empty `memberPreview` to non-members (count is kept — it's not PII). Members are unaffected. Verified: `security.spec.ts` BUG-03 block 3/3 PASS (non-member 403 + empty preview, member still sees the roster).

### BUG-04 — Block is interaction-only; reads are not blocked · **MEDIUM**
- **Affected:** read paths lacking any block/visibility filter: `src/routes/profiles.ts:106` (`GET /:username`), `src/routes/posts.ts:394` (`GET /user/:username`), `src/routes/search.ts`, `profiles.ts:148` (github-projects).
- **Steps to reproduce:** A blocks B (`POST /api/moderation/block/A`). B still gets 200 on `GET /api/profiles/A`, `GET /api/posts/user/A`, and finds A in `/api/search`.
- **Expected:** Per the schema comment ("لو A حظر B، مايشوفش بعض" — they shouldn't see each other), a block should also hide profiles/posts/search between the two parties.
- **Actual:** `assertNotBlocked` is enforced on writes (friend/follow/message/like/comment/repost) but never on reads, so a blocked user can still monitor the blocker.
- **Suggested fix:** Add a block check to profile/user-posts/search reads (filter out or 404 when a block exists in either direction). Centralize as e.g. `assertNotBlockedOrHide(viewer, target)`.
- **✅ FIXED:** Added `isBlockedBetween(a, b)` (`lib/blocks.ts`). `GET /api/profiles/:username`, `GET /api/profiles/:username/github-projects`, and `GET /api/posts/user/:username` now return 404 when a block exists in either direction (mutual invisibility, avoids revealing the block); `GET /api/search` filters out blocked users and their posts via a `notBlocked` relation clause. Verified: `security.spec.ts` BUG-04 block PASS (blocked user gets 404 on profile/posts and is absent from search; a non-blocked third party still sees the profile).

### BUG-05 — Password reset does not invalidate existing sessions · **MEDIUM**
- **Affected:** `src/lib/jwt.ts` (stateless 7-day tokens, no version/jti), `src/routes/auth.ts` `reset-password` (308) and `login`.
- **Steps to reproduce:** Attacker steals a victim's JWT. Victim runs the full forgot/reset flow. The stolen token keeps working until its 7-day expiry.
- **Expected:** Resetting the password (the standard "recover from compromise" action) revokes all outstanding tokens.
- **Actual:** No revocation mechanism; JWTs remain valid regardless of password change.
- **Suggested fix:** Add a `tokenVersion` (or `sessionsValidFrom`) column to `User`; embed it in the JWT and compare in `requireAuth`/socket auth; bump it on `reset-password` (and offer it on explicit "log out other sessions").

### BUG-06 — Rate-limit bypass via spoofable client IP · **MEDIUM (deployment-dependent)**
- **Affected:** `src/index.ts:29` (`app.set("trust proxy", 1)`) + `src/middleware/rateLimit.ts` (IP-keyed limiters).
- **Steps to reproduce:** If the app is reachable without exactly one trusted proxy in front, a client sends rotating `X-Forwarded-For` headers; Express treats each as a new client IP, so `authLimiter` (10/15m) and `apiLimiter` (300/15m) are defeated → brute-force / flooding.
- **Expected:** Rate limiting keyed on the true client IP.
- **Actual:** `trust proxy: 1` blindly trusts the first forwarded hop; correct only when a real proxy always sets it.
- **Suggested fix:** Set `trust proxy` to the actual infrastructure (e.g. the platform's known proxy count/CIDR, or `false` when directly exposed). Consider a `keyGenerator` that doesn't rely on spoofable headers, and add account-based throttling on login.

### BUG-07 — User enumeration via forgot-password timing · **LOW**
- **Affected:** `src/routes/auth.ts:271`.
- **Detail:** Response body/status are correctly identical for existing vs. non-existing emails, but the existing-email branch performs a DB write + SMTP send, creating a measurable timing gap.
- **Suggested fix:** Normalize timing (do the work asynchronously after responding, or add a constant-time floor).

### BUG-08 — Offline-message email subject not escaped · **LOW**
- **Affected:** `src/socket.ts:211` — subject uses raw `${senderName}` while the body correctly uses `safeSenderName`.
- **Detail:** `displayName` (≤60 chars, no newline restriction) flows unescaped into the subject. HTML isn't interpreted in a subject and nodemailer rejects header newlines, so impact is limited — but it's an inconsistent defense.
- **Suggested fix:** Use `safeSenderName` in the subject too, and strip control characters.

### BUG-09 — Feed loads up to 600 rows into memory per request · **LOW**
- **Affected:** `src/routes/posts.ts:75-151` (`FETCH_CAP = 300` posts + 300 reposts, merged/sorted in JS, offset-sliced).
- **Detail:** Acknowledged simplification. Fine at current scale, but per-request cost grows with data and offset paging can drop/duplicate items as new posts arrive.
- **Suggested fix:** Move to keyset pagination over a unified query when the dataset grows.

**Positive findings (defenses confirmed working):** bcrypt cost 12; reset token stored as SHA-256 hash with 30-min expiry and single-use; generic auth errors (no user enumeration via login); OAuth `state` CSRF cookie compared with `timingSafeEqual`; GitHub public email not auto-linked (account-takeover guard); `httpUrl()` blocks `javascript:`/`data:` URLs on all user-supplied links; `react-markdown` used without `rehype-raw` and `highlight.js` HTML-escapes output (no stored XSS via posts/snippets); Prisma parameterization (no SQLi); `passwordHash` never selected into responses; socket handshake auth + per-conversation membership checks on `message:send` and `typing`; helmet enabled; JSON body capped at 1 MB.

---

## 3. Summary

- **Executable checks authored:** 20 (in `src/tests/security.spec.ts`), split ~11 vulnerability probes and ~9 positive controls.
- **Expected outcome when run against the current code:** ~9 controls **PASS**, and BUG-01–BUG-04 assertions report **VULN** (the suite prints a `passed / vulnerabilities / test-failures` tally).
- **Confirmed issues:** 2 High, 4 Medium, 3 Low. **BUG-01–BUG-04 are now fixed** (verified: suite reports `29 passed · 0 vulnerabilities · 0 test-failures`, existing specs still green); BUG-05–BUG-09 remain open (session revocation, IP rate-limit, timing enumeration, email subject escaping, feed paging).

**Top risks, in order:**
1. **BUG-01** — self-serve RECRUITER role turns bulk developer PII into an open endpoint.
2. **BUG-02** — private communities are not actually private for post interactions/sub-resources.
3. **BUG-03 / BUG-04** — private rosters and blocked-user reads leak information the product implies is protected.
4. **BUG-05 / BUG-06** — session-revocation gap and IP-spoof rate-limit bypass weaken account-compromise recovery and brute-force defenses.

---

## How to run the tests

```bash
# from server/ — needs Postgres up and migrated, against a TEST database
cp .env .env.test   # point DATABASE_URL at a throwaway DB
npx prisma migrate deploy
npm run dev                      # terminal 1 — starts API+socket on :4000
npx tsx src/tests/security.spec.ts   # terminal 2 — security suite
npx tsx src/tests/chat.spec.ts       # existing suites still pass
npx tsx src/tests/communities.spec.ts
npx tsx src/tests/talent.spec.ts

# E2E (optional, needs client on :5173):
npm i -D @playwright/test && npx playwright install chromium
npx playwright test e2e/journey.spec.ts
```

> The Playwright spec lives in `server/e2e/` (not `src/`) on purpose: `tsconfig.json` includes `src`, so keeping it out avoids breaking `npm run typecheck` when `@playwright/test` isn't installed.

> The security suite creates uniquely-named users per run (timestamp tag), so it is safe to re-run, but it **does** write rows — run it against a disposable database, not production.

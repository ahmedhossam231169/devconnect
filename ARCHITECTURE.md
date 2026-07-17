# DevConnect — Architecture Baseline

> Status: **Phase 0 discovery**, generated 2026-07-17. Describes the system *as it exists today*, not the target state.
> Companion docs: `server/QA_AUDIT.md` (prior security review), `SECURITY_AUDIT.md`, `DATABASE.md`, `LOAD_TEST_REPORT.md`, `DEPLOYMENT.md` (Phases 1–4).

---

## 1. Stack inventory

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js (ESM, `"type": "module"`) | `@types/node` ^22.10 |
| Language | TypeScript | ^5.7.2 |
| HTTP framework | Express | ^4.21.2 |
| Real-time | Socket.io | ^4.8.3 |
| ORM | Prisma Client | ^5.22.0 |
| Database | PostgreSQL | via `DATABASE_URL` |
| Validation | Zod | ^3.24.1 |
| AuthN | jsonwebtoken ^9.0.2 + bcryptjs ^2.4.3 (cost 12) | |
| Headers / CORS | helmet ^8.0.0, cors ^2.8.5 | |
| Rate limiting | express-rate-limit ^8.5.2 (**in-memory store**) | |
| Mail | nodemailer ^9.0.3 (SMTP, optional) | |
| Dev runner | tsx ^4.19.2 | |

**Client** (`client/`): React 18.3 + Vite 5.4 + React Router 6.28 + Tailwind 3.4, `socket.io-client`, `react-markdown` + `remark-gfm`, `highlight.js`, `lucide-react`. Not the focus of the backend audit, but relevant to XSS and token handling.

**External services:** GitHub OAuth + GitHub REST API (project import), Google OAuth, Cloudinary (media — uploaded **client-side**, the API only ever stores URLs), SMTP provider (password reset + offline-message notifications).

**Monorepo layout:** two independent npm projects (`server/`, `client/`) with no workspace root. The root `package-lock.json` is a 95-byte stub.

### Notable absences (see task table)
No `prisma/migrations/`, no test runner, no Dockerfile, no CI config, no Redis, no OpenAPI spec, no structured logger, no process manager config.

---

## 2. Request flow

```
Browser (React SPA, Vite)
   │  Authorization: Bearer <JWT>          ← token in localStorage
   ▼
Express app  (server/src/index.ts)
   │
   ├─ app.set("trust proxy", 1)            ← assumes exactly one proxy hop
   ├─ helmet()                             ← default header set
   ├─ cors({ origin: getAllowedOrigins(), credentials: true })
   ├─ express.json({ limit: "1mb" })
   ├─ GET /api/health                      ← public, no DB touch
   ├─ GET /api/demo-error                  ← non-production only
   ├─ app.use("/api", apiLimiter)          ← 300 req / 15 min / IP
   │
   ├─ /api/auth/*          authLimiter (10/15min) on register|login|forgot|reset
   ├─ /api/{posts,profiles,communities,conversations,friends,
   │        moderation,notifications,search,feed}     requireAuth
   ├─ /api/{talent,shortlist,jobs}         requireAuth + requireRole("RECRUITER")
   │
   ├─ notFoundHandler                      → 404 {ok:false,error:{code,message}}
   └─ errorHandler                         → AppError | ZodError(422) | 500 (generic message, full log)

Socket.io  (server/src/socket.ts) — same HTTP server, same port
   └─ io.use(handshake auth) → verifyToken + tokenVersion check → socket.join(`user:{id}`)
```

**Per-request auth path** (`middleware/auth.ts`): verify JWT signature → `SELECT tokenVersion FROM User WHERE id = ?` → compare against the token's `tokenVersion` → attach `req.user`. This costs **one indexed DB read on every authenticated request and socket handshake**; it is the mechanism that makes password-reset session revocation instant.

**Error contract** (uniform across REST): `{ ok: false, error: { code, message, details? } }`. Success: `{ ok: true, ... }`.

**Real-time events emitted:** `message:new`, `typing`, `presence:update`, `post:update` (like/comment/repost counts, **broadcast to all sockets**), `profile:update` (follower counts, **broadcast to all sockets**), plus per-user notification events via `emitToUser`.

---

## 3. API endpoint inventory

72 routes. Auth column: **Public** = no token; **Auth** = valid JWT; **Recruiter** = JWT + `role === RECRUITER`; **Admin** = JWT + `isAdmin`. All non-public routes additionally revalidate `tokenVersion` against the DB.

### Auth — `/api/auth` (`routes/auth.ts`)
| Method | Path | Auth | Input | Output |
|---|---|---|---|---|
| POST | `/register` | Public + authLimiter | `{email, username, password, displayName, role, yearsExperience, resumeUrl?}` | 201 `{ok, user, token}` |
| POST | `/login` | Public + authLimiter | `{identifier, password, rememberMe?}` | `{ok, user, token}` (7d / 30d) |
| GET | `/me` | Auth | — | `{ok, user}` |
| GET | `/github` | Public | — | 302 → GitHub consent (signed `state`) |
| GET | `/github/connect-url` | Auth | — | `{ok, url}` (state = `link:<userId>`) |
| GET | `/github/callback` | Public | `?code&state` | 302 → `${CLIENT_URL}/auth/callback#token=…` |
| POST | `/forgot-password` | Public + authLimiter | `{email}` | `{ok, message}` (identical regardless of existence) |
| POST | `/reset-password` | Public + authLimiter | `{token, password}` | `{ok, message}`; bumps `tokenVersion` |
| GET | `/google` | Public | — | 302 → Google consent |
| GET | `/google/callback` | Public | `?code&state` | 302 → `${CLIENT_URL}/auth/callback#token=…` |

### Posts — `/api/posts` (`routes/posts.ts`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | Auth | Feed. `?sort=recent\|relevant&page`. Loads ≤300 posts + ≤300 reposts, merges/sorts in JS |
| POST | `/` | Auth | Create (TEXT/SNIPPET/PROJECT/QUESTION) |
| GET | `/:id` | Auth | Permalink; applies `communityVisibility()` |
| POST | `/:id/like` | Auth | Toggle reaction; visibility-gated; broadcasts `post:update` |
| POST | `/:id/repost` | Auth | Toggle repost (+ optional quote ≤500) |
| GET | `/:id/reposts` | Auth | `assertPostVisible` |
| GET | `/:id/comments` | Auth | `assertPostVisible` |
| POST | `/:id/comments` | Auth | Body ≤2000; notifies author |
| PATCH | `/:id/comments/:commentId` | Auth | Author only |
| DELETE | `/:id/comments/:commentId` | Auth | Comment author or post author |
| GET | `/user/:username` | Auth | 404 if blocked either direction |
| PATCH | `/:id` | Auth | Author only |
| DELETE | `/:id` | Auth | Author only |
| POST | `/:id/pin` | Auth | Community admin only |
| GET | `/:id/reactions` | Auth | `assertPostVisible` |

### Profiles — `/api/profiles` (`routes/profiles.ts`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/me` | Auth | Includes `discoverable`, `resumeUrl` |
| PUT | `/me` | Auth | `updateProfileSchema`; URL fields restricted to `http(s)` |
| GET | `/:username` | Auth | 404 if blocked; increments `profileViews` |
| GET | `/:username/activity` | Auth | |
| GET | `/:username/github-projects` | Auth | Proxies GitHub API with `GITHUB_TOKEN`; 404 if blocked |
| POST | `/me/complete-onboarding` | Auth | |

### Communities — `/api/communities` (`routes/communities.ts`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | Auth | List/browse |
| POST | `/` | Auth | Creator becomes ADMIN |
| GET | `/:slug` | Auth | `memberPreview` empty for non-members of private |
| POST | `/:slug/join` | Auth | Private → creates `CommunityJoinRequest` |
| GET | `/:slug/posts` | Auth | Members only if private |
| POST | `/:slug/posts` | Auth | Blocked when `adminOnlyPosting` and not admin |
| GET | `/:slug/members` | Auth | 403 to non-members of private |
| PATCH | `/:slug` | Auth | Admin only |
| DELETE | `/:slug` | Auth | Admin only |
| GET | `/:slug/requests` | Auth | Admin only |
| POST | `/:slug/requests/:username` | Auth | Admin approve/reject |
| PATCH | `/:slug/members/:username/role` | Auth | Admin only |
| DELETE | `/:slug/members/:username` | Auth | Admin, or self-leave |

### Conversations — `/api/conversations` (`routes/conversations.ts`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | Auth | Ordered by `updatedAt` |
| POST | `/` | Auth | Get-or-create 1:1 |
| POST | `/group` | Auth | Create group |
| GET | `/:id/messages` | Auth | Participants only |
| GET | `/:id/info` | Auth | Participants only |
| PATCH | `/:id` | Auth | Rename / avatar |
| GET | `/:id/media` | Auth | Shared attachments |
| DELETE | `/:id/messages` | Auth | Clear conversation |

### Friends & follows — `/api/friends` (`routes/friends.ts`)
`POST /request`, `POST /respond`, `DELETE /:username`, `GET /`, `GET /pending`, `GET /status/:username`, `POST /follow/:username` — all **Auth**. Follow/unfollow broadcasts `profile:update`.

### Moderation — `/api/moderation` (`routes/moderation.ts`)
`POST /block/:username`, `GET /blocked`, `POST /report` — all **Auth**. Filing a report returns only a message, never the report id (the reporter has no business with it).

### Admin — `/api/admin` (`routes/admin.ts`)
**Admin** = valid JWT + `User.isAdmin`. `requireAdmin` returns **404, not 403**, to non-admins: a 403 would confirm the route exists and that the caller isn't an admin, which is a hint worth denying. `isAdmin` is read from the DB inside `requireAuth` (folded into the existing `tokenVersion` select — **0 extra queries**), *not* carried in the JWT, so revoking admin takes effect on the next request without touching `tokenVersion`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/reports` | Admin | Review queue. `?status=&cursor=&limit=` — keyset paged, **oldest first** (a queue, not a feed) |
| GET | `/reports/stats` | Admin | Counts per status. Declared **before** `/reports/:id` or the `:id` route would swallow it |
| GET | `/reports/:id` | Admin | Full post body + `relatedCount` (other reports on the same target) |
| PATCH | `/reports/:id` | Admin | `{status, resolutionNote?}`; stamps reviewer. `PENDING` returns it to the queue and clears the reviewer |

Report targets are stored as loose ids (no FK) so a report survives its post being deleted — the admin still sees that a report was filed, marked `deleted: true`. Targets are hydrated with **two batched queries per page**, not one per report.

**Granting admin:** `npm run admin:grant -- <username>` / `admin:revoke` / `admin:list`. It's a script rather than an endpoint on purpose: the first admin has to come from somewhere, and any network-reachable "bootstrap the first admin" endpoint is a backdoor for whoever finds it first. Revoking the last admin needs `--force`.

**No dashboard UI exists** — this is the API a future dashboard would consume.

### Notifications — `/api/notifications`
`GET /`, `POST /:id/read`, `POST /read-all` — all **Auth**, scoped to `req.user.userId`.

### Search / Feed
`GET /api/search` (Auth) — users + posts, `contains` mode, blocked users filtered.
`GET /api/feed/sidebar` (Auth) — widgets (profile views, suggestions).

### Recruiter-only
| Method | Path | Auth |
|---|---|---|
| GET | `/api/talent/search` | Recruiter — filters `discoverable: true` |
| GET | `/api/talent/facets` | Recruiter |
| GET/POST | `/api/shortlist` | Recruiter |
| GET | `/api/shortlist/check/:username` | Recruiter |
| DELETE | `/api/shortlist/:username` | Recruiter |
| GET/POST | `/api/jobs` | Recruiter |
| PATCH/DELETE | `/api/jobs/:id` | Recruiter |
| GET/POST | `/api/jobs/:id/candidates` | Recruiter |
| PATCH/DELETE | `/api/jobs/applications/:id` | Recruiter |
| GET | `/api/jobs/dashboard` | Recruiter |
| GET | `/api/jobs/candidate/:username` | Recruiter |

### Infrastructure
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | Public | Static JSON — **does not check the DB** |
| GET | `/api/demo-error` | Public | Non-production only |

### Socket.io events (client → server)
| Event | Guard |
|---|---|
| `message:send` | Participant check + Zod (`body` ≤5000, `codeContent` ≤10000, attachment ≤20 MB, `http(s)` URLs) |
| `typing` | Participant check |
| `presence:query` | Authenticated |

---

## 4. Database schema

PostgreSQL via Prisma. **23 models, 9 enums.** Schema source: `server/prisma/schema.prisma`.

**Hosting:** the database is **Neon** (serverless Postgres, `eu-central-1`). `DATABASE_URL` targets Neon's **pooled** endpoint (PgBouncer, transaction mode); `DIRECT_DATABASE_URL` targets the same database on the direct endpoint and is used by `prisma migrate` only — PgBouncer's transaction mode breaks the advisory locks `migrate` depends on.

**Migrations:** ✅ baselined in Phase 1 as `prisma/migrations/0_init`. Generated with `migrate diff --from-empty`, verified to produce a byte-exact schema match on a throwaway database, and marked applied on the existing dev DB via `migrate resolve --applied 0_init` (zero drift was confirmed first). A fresh database is now built correctly by `prisma migrate deploy`.

### Entities & relationships

```
User 1─1 Profile ─* Experience
              └─* ProfileSkill *─1 Skill
User 1─* Post ─* Comment | Like | Repost
     │        └─? Community
User *─* Conversation  (via ConversationParticipant) ─* Message
User *─* Community     (via CommunityMember, CommunityJoinRequest)
User 1─* Notification
User *─* User          (Friendship: requester/addressee, PENDING|ACCEPTED)
User *─* User          (Follow: follower/following)
User *─* User          (Block: blocker/blocked)
User *─* User          (ShortlistEntry: recruiter/candidate)
User 1─* Report
User 1─* Job ─* Application *─1 User (candidate)
```

### Key columns

- **User** — `id` (cuid), `email` ⧉, `username` ⧉, `passwordHash?` (null for OAuth-only), `githubId?` ⧉, `googleId?` ⧉, `resetTokenHash?`, `resetTokenExpiry?`, `tokenVersion` (session revocation), `role` (DEVELOPER|RECRUITER), **`isAdmin`** (moderation privilege — separate from `role` because `role` is the account type and `requireRole` depends on it).
- **Profile** — `userId` ⧉, `displayName`, `headline?`, `bio?`, `avatarUrl?`, `bannerUrl?`, `resumeUrl?`, `location?`, `yearsExperience`, `specialty?`, `availability`, `githubUsername?`, `onboarded`, `profileViews`, **`discoverable`** (recruiter-visibility consent, default `false`).
- **Post** — `authorId`, `type`, `title?`, `body`, `codeLanguage?`, `codeContent?`, `wantsHelp`, `imageUrl?`, `pinned`, `communityId?`.
- **Community** — `slug` ⧉, `category`, `adminOnlyPosting`, `isPrivate`.
- **Message** — `conversationId`, `senderId`, `body`, `codeLanguage?`, `codeContent?`, `attachment{Url,Type,Name,Size}?`.
- **Job** — `recruiterId`, `title`, `skills String[]`, `status`. **Application** — `jobId`+`candidateId` ⧉, `stage`, `note?`.

⧉ = unique

### Indexes present
| Model | Index |
|---|---|
| Profile | `[specialty, yearsExperience, availability]`, `[discoverable]` |
| Experience | `[profileId, startYear]` |
| ProfileSkill | PK `[profileId, skillId]`, `[skillId]` |
| Post | `[authorId, createdAt]`, `[type, createdAt]`, `[communityId, createdAt]` |
| Comment | `[postId, createdAt]` |
| Like | PK `[userId, postId]`, `[postId]` |
| Repost | ⧉`[userId, postId]`, `[postId]`, `[userId, createdAt]` |
| ConversationParticipant | PK `[conversationId, userId]`, `[userId]` |
| Message | `[conversationId, createdAt]` |
| Community | `[category]` |
| CommunityMember / CommunityJoinRequest | PK `[communityId, userId]`, `[userId]` |
| Notification | `[userId, read, createdAt]` |
| Friendship | ⧉`[requesterId, addresseeId]`, `[addresseeId, status]`, `[requesterId, status]` |
| Follow | PK `[followerId, followingId]`, `[followingId]` |
| Block | PK `[blockerId, blockedId]`, `[blockedId]` |
| Report | `[createdAt]` |
| Job | `[recruiterId, status]` |
| Application | ⧉`[jobId, candidateId]`, `[jobId, stage]`, `[candidateId]` |
| ShortlistEntry | ⧉`[recruiterId, candidateId]`, `[recruiterId, createdAt]` |

**Cascade deletes** are declared on every user-owned relation, so account deletion is clean — but no delete-account endpoint exists.

### Gaps identified for Phase 2
- No `Post.createdAt` index without a leading discriminator → the "recent" global feed sort cannot use an index.
- Connection pooling is handled by **Neon's pooler**, not by the app. `new PrismaClient()` uses defaults with no `connection_limit` tuning — needs review against Neon's connection ceiling (task #17).
- ~~`Report` has no `status`/`reviewedAt` and no admin surface~~ → fixed (task #25): `ReportStatus` + reviewer columns + `@@index([status, createdAt])` serving the queue, and `/api/admin/reports`.
- No soft-delete or audit trail anywhere.

---

## 5. Configuration & secrets

`server/.env.example` documents: `DATABASE_URL`, `JWT_SECRET`, `GITHUB_CLIENT_ID/SECRET`, `GITHUB_TOKEN`, `CLIENT_URL` (comma-separated allowlist), `PORT`, `SERVER_URL`, `GOOGLE_CLIENT_ID/SECRET`, `SMTP_HOST/PORT/USER/PASS/FROM`.

- `.env` **is** gitignored; `git ls-files` confirms only `.env.example` is tracked. No secret is hardcoded anywhere in source.
- **Validation is partial**: `JWT_SECRET` fails fast at import time (`lib/jwt.ts`). Every other variable silently falls back or fails at first use — e.g. `CLIENT_URL` defaults to `http://localhost:5173`, which in production would silently mis-issue OAuth redirects and CORS.

---

## 6. Testing & tooling

| Concern | State |
|---|---|
| Test runner | **None.** No vitest/jest/supertest in either `package.json` |
| Existing specs | `src/tests/{auth,chat,communities,security,talent}.spec.ts` — hand-rolled `tsx` scripts that `fetch` a **live server on :4000** against a **real DB**, printing ✓/✗. Not assertions; no exit-code contract |
| E2E | `e2e/journey.spec.ts` — Playwright spec, but `@playwright/test` is **not installed** |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) — server and client both |
| Lint | **None** — no ESLint/Prettier config |
| CI | **None** — no `.github/workflows` |
| `npm audit --omit=dev` | **0 vulnerabilities** (server) |

---

## 7. Security posture (inherited)

`server/QA_AUDIT.md` documents a prior review of 20 areas and 9 bugs. **BUG-01 … BUG-05 are fixed and verified**; the schema changes they introduced (`Profile.discoverable`, `User.tokenVersion`) were applied with `db push` and **have no migration backing them**.

Still open: **BUG-06** (spoofable `X-Forwarded-For` → rate-limit bypass), **BUG-07** (forgot-password timing enumeration), **BUG-08** (unescaped email subject), **BUG-09** (feed loads ≤600 rows/request). These carry into `SECURITY_AUDIT.md` in Phase 1.

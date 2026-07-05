# DevConnect ⌁

> The Architecture of Connection — a community platform connecting developers, engineers, and tech recruiters.

## Structure

```
devconnect/
├── client/   # React + Vite + TypeScript + Tailwind
└── server/   # Express + TypeScript + Prisma + PostgreSQL
```

## Getting started

### 1. Server
```bash
cd server
npm install
cp .env.example .env        # عدّل DATABASE_URL بتاع Postgres عندك
npx prisma migrate dev      # ينشئ الجداول من الـ schema (Users, Posts, Conversations, Messages...)
npm run dev                 # http://localhost:4000/api/health
```

### 2. Client
```bash
cd client
npm install
npm run dev                 # http://localhost:5173
```

الـ Vite proxy بيحوّل أي `/api/*` للـ backend تلقائيًا — مفيش CORS headaches في التطوير.

## Error handling philosophy

- **Server:** كل error بيعدي من `errorHandler` middleware واحد → response موحد:
  `{ ok: false, error: { code, message, details? } }`
- **Zod validation** بترجع تفاصيل واضحة (المسار + الرسالة) بـ status 422
- **Client:** `lib/api.ts` بيحوّل أي error response لـ `ApiError` typed class
- **ErrorBoundary** بيمنع إن component واقع يوقّع الصفحة كلها

## Roadmap
- [x] Phase 1 — Project setup + DB schema + error system
- [x] Phase 2 — Auth: register/login (bcrypt+JWT), GitHub OAuth, Zod validation, role system
- [x] Phase 3 — Feed: posts (text/question/snippet + syntax highlighting), likes, comments, Latest/Top sorting, cursor pagination
- [x] Phase 4 — Real-time chat: Socket.io (JWT-auth'd sockets), 1:1 conversations, code-snippet messages, typing indicator, online presence
- [x] Phase 5 — HR Talent Search: profile editor (specialty/experience/skills), recruiter-only search API (specialty, availability, min years, multi-skill AND filter, text search), candidate detail page
- [x] Phase 6 — Communities (create/join/leave, category filters) + real-time notifications (post likes, comments, community joins) via Socket.io

## Going to production

المشروع دلوقتي فيه كل الميزات الأساسية شغالة end-to-end. قبل ما تنزله live:

- **Testing:** ضيف Vitest للـ unit tests و Playwright للـ E2E (الملفات في `server/src/tests/*.spec.ts` دلوقتي بتشتغل كـ integration scripts يدوية — حوّلها لـ test suite رسمي)
- **CI/CD:** GitHub Actions يشغّل `npm run typecheck` و`npm run build` مع كل push
- **Monitoring:** Sentry أو مشابه لتتبع الأخطاء في الإنتاج (الـ `errorHandler` بيسجّل في الـ console دلوقتي بس)
- **Rate limiting:** حط `express-rate-limit` على `/api/auth/*` بالذات عشان تمنع brute-force
- **File uploads:** الصور (avatar, project screenshots) لسه مش متعملة — هتحتاج S3 أو Cloudinary
- **Search:** البحث في الـ Navbar شكلي دلوقتي — لو عايز بحث حقيقي في البوستات والمطورين هتحتاج endpoint إضافي أو Postgres full-text search

## Security & Auth (Group Zero)
- [x] Password reset — token-based, hashed in DB, 30-min expiry, single-use
- [x] Rate limiting — strict on login/register/reset (10/15min), lenient on general API (300/15min)
- [x] Google OAuth — sign in / sign up with Google (alongside GitHub)
- [x] Email delivery — SMTP when configured, console fallback for dev

## Group 1 — Content & Profiles
- [x] Public user profiles — view anyone's profile + their posts at /u/:username
- [x] Edit / delete posts — owner-only, enforced server-side (403 otherwise)
- [x] Recruiters see the full feed — same social experience as devs, with Talent Search as an extra

## Group 2 — Social Network
- [x] Friends — send/accept/decline requests, friends list, relationship status
- [x] Follow — one-way follow/unfollow with notifications
- [x] Group chats — friends-only, built on the existing Conversation model
- [x] Moderation — block/unblock (auto-clears friendship+follow) and report posts/users

## Group 3 — Communities & Pages
- [x] Community posts — members-only posting, each community has its own feed (isolated from main feed)
- [x] Pages (facebook-style) — create pages, admin-only posting, follow/unfollow, follower counts

## Group 4 — Differentiation
- [x] GitHub projects import — live public repos on profiles (stars, language, forks)
- [x] Onboarding — 3-step guided setup after first signup (specialty, skills, availability)
- [x] Reputation — activity-based score (likes, comments, posts, friends) shown on profiles
- [x] Recruiter shortlist — save candidates with private notes ("Saved Candidates")

## Group 5 — Enhancements
- [x] Real search — live search across developers and posts with debounced dropdown
- [x] Markdown in posts — bold, code, lists, links (XSS-safe)
- [x] Image upload — Cloudinary unsigned upload for avatars
- [x] Email notifications — offline users get emailed when they receive a message
- [x] Open Graph tags — rich link previews on WhatsApp, LinkedIn, Twitter

// [BUG-08 / task #8] الجلسات: access token قصير + refresh token قابل للإلغاء.
//
// قبل الإصلاح: JWT عمره 7–30 يوم في localStorage. مالوش إلغاء، فتوكن مسروق
// = دخول كامل لشهر، ومفيش تسجيل خروج حقيقي، ومفيش تطليع جهاز بعينه.
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { api, registerUser, refreshCookieFrom, nextIp, type TestUser } from "./helpers.js";

const COOKIE = "devconnect_refresh";
const sha256 = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

/** طلب تجديد بكوكي معيّن */
function refreshWith(cookie: string, opts: { csrf?: boolean } = {}) {
  const req = request(app)
    .post("/api/auth/refresh")
    .set("X-Forwarded-For", nextIp())
    .set("Cookie", `${COOKIE}=${cookie}`);
  return opts.csrf === false ? req : req.set("X-Requested-With", "devconnect");
}

/** exp - iat بتاع الـ JWT بالثواني */
function lifetimeOf(jwt: string): number {
  const p = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64").toString());
  return p.exp - p.iat;
}

describe("issuing a session", () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await registerUser("sess");
  });

  it("issues an access token that lives 15 minutes, not days", () => {
    expect(lifetimeOf(user.token)).toBe(900);
  });

  it("sets a refresh cookie", () => {
    expect(user.refreshCookie).toBeTruthy();
  });

  it("marks the refresh cookie HttpOnly so XSS can't read it", async () => {
    const res = await api("post", "/api/auth/login").send({
      identifier: user.username,
      password: "supersecret1",
    });
    const raw = res.headers["set-cookie"];
    const line = (Array.isArray(raw) ? raw : [raw]).find((c: string) => c?.startsWith(COOKIE));
    expect(line).toMatch(/HttpOnly/i);
  });

  it("scopes the refresh cookie to /api/auth", async () => {
    const res = await api("post", "/api/auth/login").send({
      identifier: user.username,
      password: "supersecret1",
    });
    const raw = res.headers["set-cookie"];
    const line = (Array.isArray(raw) ? raw : [raw]).find((c: string) => c?.startsWith(COOKIE));
    expect(line).toMatch(/Path=\/api\/auth/i);
  });
});

describe("CSRF", () => {
  // sameSite=none في الإنتاج معناها إن المتصفح هيبعت الكوكي مع طلب جاي من
  // أي موقع. الترويسة المخصّصة بتجبر preflight، والـ preflight بيفشل لأي
  // origin بره القايمة.
  it("refuses a refresh without the custom header", async () => {
    const user = await registerUser("csrf");
    const res = await refreshWith(user.refreshCookie!, { csrf: false });
    expect(res.status).toBe(403);
  });
});

describe("rotation", () => {
  it("returns a new access token and rotates the cookie", async () => {
    const user = await registerUser("rot");
    const res = await refreshWith(user.refreshCookie!);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    const rotated = refreshCookieFrom(res);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(user.refreshCookie);
  });

  it("issues an access token that actually works", async () => {
    const user = await registerUser("rot2");
    const res = await refreshWith(user.refreshCookie!);
    const me = await api("get", "/api/auth/me", res.body.token);
    expect(me.status).toBe(200);
  });
});

describe("concurrent tabs", () => {
  // نفس الكوكي مرتين مع بعض = تابين بيجدّدوا في نفس اللحظة. لازم يبقى
  // "أعد المحاولة" مش قفل للجلسة. الحالة دي كشفت TOCTOU حقيقي في الدوران:
  // الاتنين كانوا بيقروا rotatedAt=null والاتنين بينجحوا.
  it("lets one tab win and tells the other to retry", async () => {
    const user = await registerUser("tabs");
    const [a, b] = await Promise.all([
      refreshWith(user.refreshCookie!),
      refreshWith(user.refreshCookie!),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("keeps the session alive through the race", async () => {
    const user = await registerUser("tabs2");
    const [a, b] = await Promise.all([
      refreshWith(user.refreshCookie!),
      refreshWith(user.refreshCookie!),
    ]);
    const winner = refreshCookieFrom(a.status === 200 ? a : b)!;
    const after = await refreshWith(winner);
    expect(after.status).toBe(200);
  });
});

describe("reuse detection", () => {
  it("refuses a replayed token and kills the whole family", async () => {
    const user = await registerUser("reuse");
    const first = await refreshWith(user.refreshCookie!);
    const live = refreshCookieFrom(first)!;

    // بنرجّع rotatedAt لورا عشان نعدّي شباك السماح (15 ثانية) من غير انتظار
    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(user.refreshCookie!) },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });

    const replay = await refreshWith(user.refreshCookie!);
    expect(replay.status).toBe(401);

    // ودي الحتة المهمة: إعادة الاستخدام معناها في نسختين، فاللص والضحية
    // الاتنين يتطلعوا بره — مش بس التوكن المعاد استخدامه
    const victim = await refreshWith(live);
    expect(victim.status).toBe(401);
  });
});

describe("logout", () => {
  it("kills the refresh token server-side", async () => {
    const user = await registerUser("out");
    const out = await request(app)
      .post("/api/auth/logout")
      .set("X-Forwarded-For", nextIp())
      .set("X-Requested-With", "devconnect")
      .set("Cookie", `${COOKIE}=${user.refreshCookie}`);
    expect(out.status).toBe(200);

    // من غير ده الخروج بيمسح النسخة اللي عند المستخدم بس، واللي عند اللص تفضل
    const after = await refreshWith(user.refreshCookie!);
    expect(after.status).toBe(401);
  });
});

describe("per-device sessions", () => {
  it("lists both devices and flags the current one", async () => {
    const user = await registerUser("dev1");
    await api("post", "/api/auth/login").send({
      identifier: user.username,
      password: "supersecret1",
    });

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("X-Forwarded-For", nextIp())
      .set("X-Requested-With", "devconnect")
      .set("Authorization", `Bearer ${user.token}`)
      .set("Cookie", `${COOKIE}=${user.refreshCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.some((s: { current: boolean }) => s.current)).toBe(true);
  });

  it("signs out one device without touching the other", async () => {
    const user = await registerUser("dev2");
    const second = await api("post", "/api/auth/login").send({
      identifier: user.username,
      password: "supersecret1",
    });
    const deviceB = refreshCookieFrom(second)!;

    const list = await request(app)
      .get("/api/auth/sessions")
      .set("X-Forwarded-For", nextIp())
      .set("X-Requested-With", "devconnect")
      .set("Authorization", `Bearer ${user.token}`)
      .set("Cookie", `${COOKIE}=${user.refreshCookie}`);
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);

    const kill = await api("delete", `/api/auth/sessions/${other.id}`, user.token);
    expect(kill.status).toBe(200);

    expect((await refreshWith(deviceB)).status).toBe(401);
    expect((await refreshWith(user.refreshCookie!)).status).toBe(200);
  });

  it("won't let one user kill another user's session", async () => {
    const victim = await registerUser("victim");
    const attacker = await registerUser("attacker");

    const list = await request(app)
      .get("/api/auth/sessions")
      .set("X-Forwarded-For", nextIp())
      .set("X-Requested-With", "devconnect")
      .set("Authorization", `Bearer ${victim.token}`)
      .set("Cookie", `${COOKIE}=${victim.refreshCookie}`);
    const familyId = list.body.sessions[0].id;

    const res = await api("delete", `/api/auth/sessions/${familyId}`, attacker.token);
    expect(res.status).toBe(404);
    // والجلسة نفسها لازم تفضل شغالة
    expect((await refreshWith(victim.refreshCookie!)).status).toBe(200);
  });
});

describe("password reset", () => {
  // من غير ده، حد سرق الحساب بيفضل ماسك refresh token شغال بعد ما الضحية
  // تغيّر الباسورد — يعني إعادة التعيين مابتطردهوش، وهي دي وظيفتها
  it("evicts existing sessions", async () => {
    const user = await registerUser("reset");
    const resetToken = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: sha256(resetToken),
        resetTokenExpiry: new Date(Date.now() + 3_600_000),
      },
    });

    const reset = await api("post", "/api/auth/reset-password").send({
      token: resetToken,
      password: "brandnewpass9",
    });
    expect(reset.status).toBe(200);

    const after = await refreshWith(user.refreshCookie!);
    expect(after.status).toBe(401);
  });
});

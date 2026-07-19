// [BUG-06] حماية من الـ brute force على مستوى الحساب نفسه.
//
// الـ rate limiting بتاع الـ IP لوحده مابيحميش من هجوم موزّع: مهاجم عنده
// مئات الـ IPs بياخد من كل واحد نصيبه ويكمّل على نفس الحساب. عشان كده
// العدّاد بيتخزن في الداتابيز على اليوزر — وبيعيش بعد أي restart كمان،
// عكس أي عدّاد في الذاكرة.
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../lib/prisma.js";
import { api, registerUser, type TestUser } from "./helpers.js";

// لازم يطابق MAX_FAILED_ATTEMPTS في lib/loginThrottle.ts
const MAX_ATTEMPTS = 20;

let user: TestUser;
beforeAll(async () => {
  user = await registerUser("throttle");
});

/** محاولة دخول بباسورد غلط — كل واحدة من IP مختلف (هجوم موزّع) */
const failedLogin = () =>
  api("post", "/api/auth/login").send({ identifier: user.username, password: "wrong-password" });

const attemptsFor = async (id: string) =>
  (await prisma.user.findUnique({ where: { id }, select: { failedLoginAttempts: true } }))!
    .failedLoginAttempts;

describe("per-account throttling", () => {
  it("counts failures even when every attempt comes from a different IP", async () => {
    // ده بالظبط اللي حد الـ IP مابيمسكوش
    const before = await attemptsFor(user.id);
    await failedLogin();
    await failedLogin();
    expect(await attemptsFor(user.id)).toBe(before + 2);
  });

  it("locks the account after the threshold", async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: MAX_ATTEMPTS - 1, lockedUntil: null },
    });
    await failedLogin(); // دي اللي بتكمّل الحد

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { lockedUntil: true },
    });
    expect(row!.lockedUntil).toBeTruthy();
    expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects the CORRECT password while locked", async () => {
    // الحماية مالهاش لازمة لو الباسورد الصح بيعدّي في وقت القفل
    const res = await api("post", "/api/auth/login").send({
      identifier: user.username,
      password: "supersecret1",
    });
    expect(res.status).toBe(401);
  });

  it("uses the same generic message when locked, so it isn't an enumeration oracle", async () => {
    // رسالة "الحساب متقفل" كانت هتأكد إن الحساب موجود
    const locked = await api("post", "/api/auth/login").send({
      identifier: user.username,
      password: "supersecret1",
    });
    const unknown = await api("post", "/api/auth/login").send({
      identifier: `ghost_${Date.now()}`,
      password: "supersecret1",
    });
    expect(locked.body.error.message).toBe(unknown.body.error.message);
  });
});

describe("recovery", () => {
  it("clears the lock on a successful login", async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 3, lockedUntil: null },
    });
    const res = await api("post", "/api/auth/login").send({
      identifier: user.username,
      password: "supersecret1",
    });
    expect(res.status).toBe(200);
    expect(await attemptsFor(user.id)).toBe(0);
  });

  it("lets a password reset unlock a victim who was locked out", async () => {
    // من غير ده مهاجم يقدر يمنع صاحب الحساب من الدخول باستمرار،
    // حتى بعد ما يغيّر باسورده
    const crypto = await import("node:crypto");
    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: MAX_ATTEMPTS,
        lockedUntil: new Date(Date.now() + 15 * 60_000),
        resetTokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
        resetTokenExpiry: new Date(Date.now() + 3_600_000),
      },
    });

    const reset = await api("post", "/api/auth/reset-password").send({
      token: raw,
      password: "freshpassword9",
    });
    expect(reset.status).toBe(200);

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { lockedUntil: true, failedLoginAttempts: true },
    });
    expect(row!.lockedUntil).toBeNull();
    expect(row!.failedLoginAttempts).toBe(0);
  });
});

// [#15] الترويسات و CORS — بتقفل الباب على regression صامت: تغيير في helmet
// أو في إعداد CORS ممكن يفتح ثغرة من غير ما يكسر أي ميزة، فمحدش ياخد باله.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { api } from "./helpers.js";

const ALLOWED = "http://localhost:5173"; // لازم يطابق CLIENT_URL
const EVIL = "https://evil.example.com";

describe("security headers", () => {
  it("sets the baseline helmet headers", async () => {
    const res = await api("get", "/api/livez");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(res.headers["referrer-policy"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["x-frame-options"]).toBeDefined();
  });

  it("does not advertise the framework", async () => {
    // helmet بيشيلها — وجودها بيدي أي ماسح الـ framework والإصدار ببلاش
    const res = await api("get", "/api/livez");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("cache", () => {
  // من غير توجيه صريح المتصفح بيخزّن استدلاليًا: رد /api/auth/me (إيميل،
  // اسم، بروفايل) بيتكتب على القرص ويفضل مقروء بعد تسجيل الخروج
  it("marks every API response no-store", async () => {
    const res = await api("get", "/api/livez");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("marks authenticated responses no-store too", async () => {
    const res = await api("get", "/api/auth/me", "invalid-token");
    expect(res.headers["cache-control"]).toContain("no-store");
  });
});

describe("CORS", () => {
  it("echoes an allowed origin", async () => {
    const res = await request(app).get("/api/livez").set("Origin", ALLOWED);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  // ★ الفحص الجوهري: لو الـ origin المجهول اترجع، أي موقع يقدر يقرا ردود
  // الـ API بهوية المستخدم — وعليه كمان بتنهار حماية CSRF بتاعة /refresh
  it("does NOT reflect an unknown origin", async () => {
    const res = await request(app).get("/api/livez").set("Origin", EVIL);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not answer an unknown origin with a wildcard either", async () => {
    const res = await request(app).get("/api/livez").set("Origin", EVIL);
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("sets Vary: Origin so caches can't cross-serve a CORS decision", async () => {
    const res = await request(app).get("/api/livez").set("Origin", ALLOWED);
    expect((res.headers["vary"] ?? "").toLowerCase()).toContain("origin");
  });
});

describe("CSRF chain on /api/auth/refresh", () => {
  const preflight = (origin: string) =>
    request(app)
      .options("/api/auth/refresh")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "x-requested-with");

  it("denies a preflight from a foreign origin", async () => {
    // من غير ACAO المتصفح مابيبعتش الطلب الحقيقي أصلاً
    const res = await preflight(EVIL);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows a preflight from our own origin", async () => {
    const res = await preflight(ALLOWED);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("refuses a refresh without the custom header at the route", async () => {
    // الطبقة التانية: حتى لو حد عدّى الـ preflight
    const res = await request(app).post("/api/auth/refresh").set("X-Forwarded-For", "198.51.200.1");
    expect(res.status).toBe(403);
  });
});

describe("request body limits", () => {
  // الحد كان شغال، بس الرد كان 500 — يعني خطأ عميل بيتسجل كعطل سيرفر
  // وبيغرق أي error monitoring بأعطال وهمية
  it("rejects an oversized body as 413, not 500", async () => {
    const res = await api("post", "/api/auth/login").send({
      identifier: "x".repeat(2 * 1024 * 1024),
      password: "y",
    });
    expect(res.status).toBe(413);
  });

  it("rejects malformed JSON as 400, not 500", async () => {
    const res = await api("post", "/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
  });
});

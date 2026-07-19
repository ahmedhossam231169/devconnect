// [task #25] سطح المراجعة للمشرفين. قبل كده البلاغات كانت بتتكتب وخلاص:
// مفيش status، مفيش مراجع، ومفيش endpoint يقراها.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma.js";
import { api, registerUser, TAG, type TestUser } from "./helpers.js";

let mod: TestUser;
let author: TestUser;
let reporter: TestUser;
let postId: string;
let reportId: string;

const setAdmin = (id: string, isAdmin: boolean) =>
  prisma.user.update({ where: { id }, data: { isAdmin } });

beforeAll(async () => {
  mod = await registerUser("mod");
  author = await registerUser("author");
  reporter = await registerUser("reporter");

  const post = await api("post", "/api/posts", author.token).send({
    type: "TEXT",
    body: "spammy content here",
  });
  expect(post.status).toBe(201);
  postId = post.body.post.id;

  const filed = await api("post", "/api/moderation/report", reporter.token).send({
    postId,
    reason: "This looks like spam",
  });
  expect(filed.status).toBe(201);

  // الـ id بنجيبه من الداتابيز: POST /report بيرجّع رسالة بس عن قصد —
  // المبلّغ مالوش دعوة بمعرّف البلاغ
  const row = await prisma.report.findFirst({
    where: { targetPostId: postId },
    select: { id: true },
  });
  reportId = row!.id;
});

// السويت بتدي صلاحية أدمن ليوزر اختباري — لو ماتنضفتش بيفضل أدمن في الداتابيز.
// حصل فعلاً وإحنا بنبني السويت دي.
afterAll(async () => {
  await prisma.user.updateMany({
    where: { username: { endsWith: `_${TAG}` }, isAdmin: true },
    data: { isAdmin: false },
  });
});

describe("access control", () => {
  it("rejects an anonymous caller", async () => {
    const res = await api("get", "/api/admin/reports");
    expect(res.status).toBe(401);
  });

  // 404 مش 403: الـ 403 بتأكد إن المسار موجود وإن الحساب ده مش أدمن،
  // وده بيدي المهاجم إشارة يدوّر بيها
  it("returns 404, not 403, to a non-admin", async () => {
    const res = await api("get", "/api/admin/reports", reporter.token);
    expect(res.status).toBe(404);
  });

  it("stops a non-admin closing a real report", async () => {
    // لازم id حقيقي: id مخترع كان هيرجّع 404 بسبب "مش موجود" مش بسبب الجارد،
    // فالتست كان هينجح حتى والحماية مقفولة
    const res = await api("patch", `/api/admin/reports/${reportId}`, reporter.token).send({
      status: "DISMISSED",
    });
    expect(res.status).toBe(404);

    const still = await prisma.report.findUnique({ where: { id: reportId } });
    expect(still!.status).toBe("PENDING");
  });
});

describe("queue", () => {
  beforeAll(async () => {
    await setAdmin(mod.id, true);
  });

  it("shows the queue on the same token the user already had", async () => {
    // الصلاحية بتتقرا من الداتابيز، فبتسري من غير تسجيل دخول جديد
    const res = await api("get", "/api/admin/reports?status=PENDING", mod.token);
    expect(res.status).toBe(200);
  });

  it("includes the filed report with its target hydrated", async () => {
    const res = await api("get", "/api/admin/reports?status=PENDING", mod.token);
    const mine = res.body.reports.find((r: { id: string }) => r.id === reportId);
    expect(mine).toBeTruthy();
    expect(mine.target.excerpt).toContain("spammy");
    expect(mine.reporter.username).toBe(reporter.username);
  });

  it("serves /reports/stats rather than treating it as an :id", async () => {
    // لو الترتيب اتعكس، /reports/stats كان هيتفسّر كـ id
    const res = await api("get", "/api/admin/reports/stats", mod.token);
    expect(res.status).toBe(200);
    expect(res.body.stats).toHaveProperty("PENDING");
  });
});

describe("review", () => {
  it("returns the full body on the detail view", async () => {
    const res = await api("get", `/api/admin/reports/${reportId}`, mod.token);
    expect(res.body.report.fullBody).toBe("spammy content here");
  });

  it("stamps the reviewer on resolve and drops it from PENDING", async () => {
    const res = await api("patch", `/api/admin/reports/${reportId}`, mod.token).send({
      status: "RESOLVED",
      resolutionNote: "removed, warned the author",
    });
    expect(res.status).toBe(200);
    expect(res.body.report.reviewer).toBe(mod.username);
    expect(res.body.report.reviewedAt).toBeTruthy();

    const queue = await api("get", "/api/admin/reports?status=PENDING", mod.token);
    expect(queue.body.reports.some((r: { id: string }) => r.id === reportId)).toBe(false);
  });

  it("clears the reviewer when a report is reopened", async () => {
    // غير كده بيفضل مراجع متسجّل على بلاغ محدش بيراجعه
    const res = await api("patch", `/api/admin/reports/${reportId}`, mod.token).send({
      status: "PENDING",
    });
    expect(res.body.report.reviewer).toBeNull();
    expect(res.body.report.reviewedAt).toBeNull();
  });
});

describe("deleted target", () => {
  it("keeps the report after its post is deleted", async () => {
    // البلاغ سجل تاريخي — لو اختفى مع المحتوى، المشرف مش هيعرف إن في بلاغ اتقدم
    await api("delete", `/api/posts/${postId}`, author.token);
    const res = await api("get", `/api/admin/reports/${reportId}`, mod.token);
    expect(res.status).toBe(200);
    expect(res.body.report.target.deleted).toBe(true);
  });
});

describe("revocation", () => {
  it("takes effect on the same token, with no logout needed", async () => {
    await setAdmin(mod.id, false);
    const res = await api("get", "/api/admin/reports", mod.token);
    expect(res.status).toBe(404);
  });
});

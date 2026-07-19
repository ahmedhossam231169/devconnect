// [BUG-10] البث اللحظي لازم يحترم نفس قواعد الرؤية بتاعة الـ REST.
//
// قبل الإصلاح broadcastPostUpdate/broadcastProfileUpdate كانوا بيستخدموا
// io.emit — يعني الحدث بيروح لكل متصل. النتيجة إن أي حد فاتح التطبيق كان
// بيستقبل تحديثات بوستات الكوميونتيهات الخاصة اللي مش عضو فيها: نفس
// الضمانة اللي BUG-02 قفلها في الـ REST كانت بتتسرب من الـ real-time.
//
// دي السويت الوحيدة اللي محتاجة سيرفر حقيقي — socket.io محتاج اتصال فعلي،
// فـ supertest لوحده مايكفيش. بنشغّله على بورت عشوائي عشان ما نتعارضش مع
// أي سيرفر تطوير شغال.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket } from "socket.io-client";
import request from "supertest";
import { app } from "../app.js";
import { setupSocket } from "../socket.js";
import { nextIp, TAG } from "./helpers.js";

let httpServer: HttpServer;
let io: ReturnType<typeof setupSocket>;
let base: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  httpServer = createServer(app);
  io = setupSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  base = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

function req(method: "get" | "post", path: string, token?: string, body?: unknown) {
  const r = request(base)[method](path)
    .set("X-Forwarded-For", nextIp())
    .set("X-Requested-With", "devconnect");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body ? r.send(body) : r;
}

async function register(handle: string) {
  const username = `${handle}_${TAG}`.slice(0, 30);
  const res = await req("post", "/api/auth/register", undefined, {
    email: `${username}@devconnect.com`,
    username,
    password: "supersecret1",
    displayName: handle,
    yearsExperience: 3,
    resumeUrl: "https://res.cloudinary.com/demo/raw/upload/cv.pdf",
  });
  if (res.status !== 201) throw new Error(`register ${handle}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, username };
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { auth: { token }, transports: ["websocket"] });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
    setTimeout(() => reject(new Error("socket connect timeout")), 8000);
  });
}

/** بيجمّع كل أحداث event اللي توصل للسوكيت ده */
function collect(socket: Socket, event: string): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  socket.on(event, (p) => seen.push(p));
  return seen;
}

// البث غير متزامن — محتاجين مهلة قصيرة قبل ما نتحقق
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

describe("post:update is scoped to the audience allowed to see the post", () => {
  let owner: { token: string; username: string };
  let outsider: { token: string; username: string };
  let privatePostId: string;
  let publicPostId: string;
  let ownerEvents: Record<string, unknown>[];
  let outsiderEvents: Record<string, unknown>[];

  beforeAll(async () => {
    owner = await register("owner");
    outsider = await register("outsider");

    const community = await req("post", "/api/communities", owner.token, {
      name: `Private Guild ${TAG}`,
      category: "Backend",
      isPrivate: true,
    });
    expect(community.status).toBe(201);
    const slug = community.body.community.slug;

    const priv = await req("post", `/api/communities/${slug}/posts`, owner.token, {
      type: "TEXT",
      body: "secret internal discussion",
    });
    expect(priv.status).toBe(201);
    privatePostId = priv.body.post.id;

    const pub = await req("post", "/api/posts", owner.token, { type: "TEXT", body: "hello world" });
    publicPostId = pub.body.post.id;

    const ownerSock = await connect(owner.token);
    const outsiderSock = await connect(outsider.token);
    ownerEvents = collect(ownerSock, "post:update");
    outsiderEvents = collect(outsiderSock, "post:update");
    await settle(300);

    await req("post", `/api/posts/${privatePostId}/like`, owner.token);
    await req("post", `/api/posts/${publicPostId}/like`, owner.token);
    await settle();
  });

  it("REST still hides the private post from an outsider (BUG-02 holds)", async () => {
    const res = await req("get", `/api/posts/${privatePostId}`, outsider.token);
    expect(res.status).toBe(404);
  });

  it("delivers the private post's update to a member", () => {
    // لو ده فشل يبقى البث ضيّق زيادة والميزة نفسها مكسورة
    expect(ownerEvents.some((e) => e.postId === privatePostId)).toBe(true);
  });

  it("does NOT leak the private post's update to an outsider", () => {
    expect(outsiderEvents.some((e) => e.postId === privatePostId)).toBe(false);
  });

  // ضابط التحكم: من غيره، بث معطّل تمامًا كان "هينجح" الاختبار اللي فوق
  it("control: a public post's update still reaches everyone", () => {
    expect(outsiderEvents.some((e) => e.postId === publicPostId)).toBe(true);
    expect(ownerEvents.some((e) => e.postId === publicPostId)).toBe(true);
  });
});

describe("profile:update excludes blocked users (BUG-04 gap)", () => {
  it("reaches a normal user but not someone the subject blocked", async () => {
    const owner = await register("powner");
    const blocked = await register("pblocked");
    const third = await register("pthird");

    const blockedSock = await connect(blocked.token);
    const blockedEvents = collect(blockedSock, "profile:update");

    await req("post", `/api/moderation/block/${blocked.username}`, owner.token);
    await settle(300);

    const thirdSock = await connect(third.token);
    const thirdEvents = collect(thirdSock, "profile:update");
    await settle(300);

    await req("post", `/api/friends/follow/${owner.username}`, third.token);
    await settle();

    expect(thirdEvents.some((e) => e.username === owner.username)).toBe(true);
    expect(blockedEvents.some((e) => e.username === owner.username)).toBe(false);
  });
});

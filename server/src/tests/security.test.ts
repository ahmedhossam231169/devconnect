// BUG-01 … BUG-05 — الثغرات اللي اتصلحت في المراجعة الأولى (server/QA_AUDIT.md).
//
// دي أهم سويت في المشروع: من غيرها مفيش أي حاجة بتمنع رجوع الخمس ثغرات دي،
// وكلها من النوع اللي بيرجع بسهولة مع أول تعديل على استعلام أو select.
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { api, registerUser, TAG, type TestUser } from "./helpers.js";

const sha256 = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let recruiter: TestUser;

async function registerRecruiter(handle: string): Promise<TestUser> {
  const username = `${handle}_${TAG}`.slice(0, 30);
  const email = `${username}@devconnect.com`;
  const res = await api("post", "/api/auth/register").send({
    email,
    username,
    password: "supersecret1",
    displayName: handle,
    role: "RECRUITER",
    yearsExperience: 5,
  });
  if (res.status !== 201) throw new Error(`recruiter register: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, username, email, id: res.body.user.id, refreshCookie: null };
}

beforeAll(async () => {
  owner = await registerUser("sowner");
  member = await registerUser("smember");
  outsider = await registerUser("soutsider");
  recruiter = await registerRecruiter("srecruiter");
});

// ---------------------------------------------------------------
// BUG-01 — البحث عن المواهب لازم يحترم موافقة الظهور (discoverable).
// تسجيل الـ RECRUITER مفتوح بالتصميم، فالضمانة الوحيدة إن غير الموافقين
// مايظهروش — يعني مايتحوّلش لدليل بأسماء كل المطورين.
// ---------------------------------------------------------------
describe("BUG-01 — talent search respects the discoverable opt-in", () => {
  const names = (body: { candidates?: { username: string }[] }) =>
    (body.candidates ?? []).map((c) => c.username);

  // ⚠️ بنبحث بـ q=TAG عشان نضيّق النتيجة على مستخدمي التشغيلة دي.
  // من غير كده الفحص بيبص على أول صفحة من كل الحسابات في الداتابيز —
  // وحساباتنا مابتظهرش فيها أصلاً وسط بيانات التشغيلات القديمة، فالفحص
  // "بينجح" حتى والفلتر مشال بالكامل. (اتكشفت بالـ negative control.)
  const search = () => api("get", `/api/talent/search?q=${TAG}`, recruiter.token);

  it("does not expose developers who never opted in", async () => {
    const res = await search();
    expect(res.status).toBe(200);
    const found = names(res.body);
    expect(found).not.toContain(owner.username);
    expect(found).not.toContain(member.username);
    expect(found).not.toContain(outsider.username);
  });

  it("shows a developer once they opt in, without exposing the rest", async () => {
    await api("put", "/api/profiles/me", owner.token).send({
      discoverable: true,
      specialty: "Backend",
    });
    const res = await search();
    const found = names(res.body);
    expect(found).toContain(owner.username); // الضابط: الميزة نفسها شغالة
    expect(found).not.toContain(member.username);
    expect(found).not.toContain(outsider.username);
  });
});

// ---------------------------------------------------------------
// BUG-02 — الـ permalink كان محجوب صح، لكن الموارد الفرعية للبوست
// (كومنتات/تفاعلات/ريبوستات) ماكانتش بتتفحص، فمحتوى الكوميونتي الخاص
// كان بيتسرب من الأبواب الجانبية.
// ---------------------------------------------------------------
describe("BUG-02 — private-community post sub-resources are gated", () => {
  let slug: string;
  let postId: string;

  beforeAll(async () => {
    const created = await api("post", "/api/communities", owner.token).send({
      name: `Secret Guild ${TAG}`,
      description: "private",
      category: "Backend",
    });
    slug = created.body.community.slug;
    // بينضم والكوميونتي لسه عام، وبعدين بيبقى خاص — عشان نتأكد إن العضوية
    // القديمة بتفضل شغالة والغريب بيتحجب
    await api("post", `/api/communities/${slug}/join`, member.token);
    await api("patch", `/api/communities/${slug}`, owner.token).send({ isPrivate: true });

    const post = await api("post", `/api/communities/${slug}/posts`, owner.token).send({
      type: "TEXT",
      body: `TOP SECRET internal note ${TAG}`,
    });
    postId = post.body.post.id;
  });

  it("hides the permalink from an outsider", async () => {
    const res = await api("get", `/api/posts/${postId}`, outsider.token);
    expect(res.status).toBe(404);
  });

  it.each(["comments", "reactions", "reposts"])(
    "hides /%s from an outsider",
    async (sub) => {
      const res = await api("get", `/api/posts/${postId}/${sub}`, outsider.token);
      expect(res.status).toBe(404);
    }
  );

  it("stops an outsider commenting on it", async () => {
    const res = await api("post", `/api/posts/${postId}/comments`, outsider.token).send({
      body: "I shouldn't be able to do this",
    });
    expect(res.status).toBe(404);
  });

  it("stops an outsider liking it", async () => {
    const res = await api("post", `/api/posts/${postId}/like`, outsider.token);
    expect(res.status).toBe(404);
  });

  // الضابط: لو ده فشل يبقى إحنا حجبنا الأعضاء كمان، يعني كسرنا الميزة
  it("control: a member can still read it", async () => {
    const res = await api("get", `/api/posts/${postId}`, member.token);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------
// BUG-03 — تفاصيل الكوميونتي الخاص وقائمة أعضائه كانت مكشوفة لغير الأعضاء.
// ---------------------------------------------------------------
describe("BUG-03 — private community roster is hidden from non-members", () => {
  let slug: string;

  beforeAll(async () => {
    const created = await api("post", "/api/communities", owner.token).send({
      name: `Roster Guild ${TAG}`,
      category: "Backend",
    });
    slug = created.body.community.slug;
    await api("patch", `/api/communities/${slug}`, owner.token).send({ isPrivate: true });
  });

  it("refuses the member list to a non-member", async () => {
    const res = await api("get", `/api/communities/${slug}/members`, outsider.token);
    expect(res.status).toBe(403);
  });

  it("leaks no posts to a non-member", async () => {
    // الراوت بيرجّع 200 مع قايمة فاضية + private:true عن قصد (مش 403)، عشان
    // الواجهة تعرض "اطلب الانضمام" من غير نداء تاني. الخاصية الأمنية هي إن
    // مفيش بوست بيتسرّب — مش رقم الحالة، فالفحص عليها هي.
    const res = await api("get", `/api/communities/${slug}/posts`, outsider.token);
    expect(res.body.posts ?? []).toHaveLength(0);
    expect(res.body.private).toBe(true);
  });

  it("does not leak a member preview in the detail view", async () => {
    const res = await api("get", `/api/communities/${slug}`, outsider.token);
    // الكوميونتي نفسه ممكن يبان (عشان يقدر يطلب الانضمام)، إنما مش أعضاؤه
    if (res.status === 200) {
      expect(res.body.community.memberPreview ?? []).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------
// BUG-04 — الحظر لازم يخفي الحاظر عن المحظور في كل القراءات.
// ---------------------------------------------------------------
describe("BUG-04 — a block hides the blocker from the blocked user", () => {
  let blocker: TestUser;
  let blocked: TestUser;

  beforeAll(async () => {
    blocker = await registerUser("blocker");
    blocked = await registerUser("blockee");
    const res = await api("post", `/api/moderation/block/${blocked.username}`, blocker.token);
    expect(res.body.blocked).toBe(true);
  });

  it("hides the blocker's profile", async () => {
    const res = await api("get", `/api/profiles/${blocker.username}`, blocked.token);
    expect(res.status).toBe(404);
  });

  it("hides the blocker's posts", async () => {
    const res = await api("get", `/api/posts/user/${blocker.username}`, blocked.token);
    expect(res.status).toBe(404);
  });

  it("hides the blocker's activity", async () => {
    const res = await api("get", `/api/profiles/${blocker.username}/activity`, blocked.token);
    expect(res.status).toBe(404);
  });

  it("keeps the blocker visible to everyone else", async () => {
    const res = await api("get", `/api/profiles/${blocker.username}`, outsider.token);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------
// BUG-05 — إعادة تعيين الباسورد لازم تبطّل الجلسات القديمة فورًا.
// ده الفرق بين "غيّرت الباسورد" و"طردت اللي داخل على حسابي".
// ---------------------------------------------------------------
describe("BUG-05 — password reset revokes existing sessions", () => {
  it("rejects the old access token immediately after a reset", async () => {
    const victim = await registerUser("victim5");

    const before = await api("get", "/api/auth/me", victim.token);
    expect(before.status).toBe(200); // الضابط: التوكن كان شغال فعلاً

    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: victim.id },
      data: {
        resetTokenHash: sha256(raw),
        resetTokenExpiry: new Date(Date.now() + 3_600_000),
      },
    });

    const reset = await api("post", "/api/auth/reset-password").send({
      token: raw,
      password: "totallynewpass1",
    });
    expect(reset.status).toBe(200);

    const after = await api("get", "/api/auth/me", victim.token);
    expect(after.status).toBe(401);
  });

  it("issues a working token on the next login", async () => {
    const u = await registerUser("victim5b");
    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: u.id },
      data: { resetTokenHash: sha256(raw), resetTokenExpiry: new Date(Date.now() + 3_600_000) },
    });
    await api("post", "/api/auth/reset-password").send({ token: raw, password: "totallynewpass1" });

    const login = await api("post", "/api/auth/login").send({
      identifier: u.username,
      password: "totallynewpass1",
    });
    expect(login.status).toBe(200);
    const me = await api("get", "/api/auth/me", login.body.token);
    expect(me.status).toBe(200);
  });
});

// ---------------------------------------------------------------
// أساسيات الـ JWT — التوقيع هو اللي كل الصلاحيات قايمة عليه.
// ---------------------------------------------------------------
describe("JWT integrity", () => {
  it("rejects a tampered token", async () => {
    const u = await registerUser("jwt1");
    // بنغيّر آخر حرف في التوقيع
    const tampered = u.token.slice(0, -1) + (u.token.endsWith("A") ? "B" : "A");
    const res = await api("get", "/api/auth/me", tampered);
    expect(res.status).toBe(401);
  });

  it("rejects a missing token", async () => {
    const res = await api("get", "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const forged = jwt.sign({ userId: owner.id, role: "DEVELOPER", tokenVersion: 0 }, "not-the-real-secret-not-the-real-secret");
    const res = await api("get", "/api/auth/me", forged);
    expect(res.status).toBe(401);
  });
});

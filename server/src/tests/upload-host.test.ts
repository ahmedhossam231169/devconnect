// [BUG-11] الحقول المرفوعة لازم تكون على Cloudinary بتاعنا — مش أي رابط.
// قبل الإصلاح أي مستخدم كان يقدر يحط avatarUrl على سيرفر بيتحكم فيه، فمتصفح
// كل من يفتح البروفايل بيجيب الصورة من هناك (تسريب IP + تتبّع)، وبيتخطى
// Cloudinary تمامًا (مفيش حد حجم ولا إشراف).
import { describe, it, expect, beforeAll } from "vitest";
import { api, registerUser, CLOUDINARY_URL, type TestUser } from "./helpers.js";

let user: TestUser;
beforeAll(async () => {
  user = await registerUser("uploader");
});

describe("profile avatar", () => {
  it("accepts a real Cloudinary URL", async () => {
    const res = await api("put", "/api/profiles/me", user.token).send({ avatarUrl: CLOUDINARY_URL });
    expect(res.status).toBe(200);
  });

  // الحالتين التانيين مهمين: مضيف بيبدأ بنفس النص، ومضيف بيخلص بيه —
  // فحص بـ includes/startsWith كان هيعدّيهم
  it.each([
    ["attacker-controlled host", "https://evil.example.com/track.png"],
    ["look-alike host", "https://res.cloudinary.com.evil.com/x.png"],
    ["subdomain trick", "https://evilres.cloudinary.com/x.png"],
    ["data: URL", "data:image/png;base64,AAAA"],
    ["javascript: URL", "javascript:alert(1)"],
  ])("rejects %s", async (_label, url) => {
    const res = await api("put", "/api/profiles/me", user.token).send({ avatarUrl: url });
    expect(res.status).toBe(422);
  });
});

describe("post image", () => {
  it("accepts a real Cloudinary URL", async () => {
    const res = await api("post", "/api/posts", user.token).send({
      type: "TEXT",
      body: "hi",
      imageUrl: CLOUDINARY_URL,
    });
    expect(res.status).toBe(201);
  });

  it("rejects a foreign host", async () => {
    const res = await api("post", "/api/posts", user.token).send({
      type: "TEXT",
      body: "hi",
      imageUrl: "https://evil.example.com/pixel.gif",
    });
    expect(res.status).toBe(422);
  });
});

// مهم بنفس القدر: ما نبالغش في التقييد. websiteUrl و githubUrl روابط خارجية
// شرعية للمستخدم — لو قيّدناها على Cloudinary نكون كسرنا ميزة عشان نأمّن غيرها
describe("external links stay unrestricted", () => {
  it("allows an arbitrary personal site", async () => {
    const res = await api("put", "/api/profiles/me", user.token).send({
      websiteUrl: "https://my-portfolio.dev",
    });
    expect(res.status).toBe(200);
  });

  it("allows a github.com URL", async () => {
    const res = await api("put", "/api/profiles/me", user.token).send({
      githubUrl: "https://github.com/someone",
    });
    expect(res.status).toBe(200);
  });

  it("still rejects javascript: on external links", async () => {
    const res = await api("put", "/api/profiles/me", user.token).send({
      websiteUrl: "javascript:alert(1)",
    });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------
// مساعدات مشتركة للاختبارات
//
// الفكرة الأساسية: كل طلب بياخد IP فريد.
// الـ authLimiter بيسمح بـ 10 طلبات auth لكل IP كل 15 دقيقة. السويتات
// بتعمل عشرات الطلبات، فمن غير العزل ده كانت هتاخد 429 بعد العاشر —
// والأخطر إن 429 بترجع بسرعة وبشكل موحّد، فاختبار زي قياس التوقيت "بينجح"
// وهو مش بيقيس حاجة أصلاً. (حصلت فعلاً — شوف forgot-password-timing.)
// ---------------------------------------------------------------
import request from "supertest";
import { app } from "../app.js";

/** عدّاد عام: كل طلب في التشغيلة كلها بياخد IP مختلف */
let ipCounter = 0;
export function nextIp(): string {
  ipCounter++;
  // نطاق TEST-NET-2 المخصص للتوثيق، موسّع على بايتين
  return `198.51.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

/** معرّف فريد للتشغيلة — عشان الحسابات ما تتصادمش بين التشغيلات */
export const TAG = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

type Method = "get" | "post" | "put" | "patch" | "delete";

/**
 * طلب على الـ app نفسه (من غير سيرفر على بورت).
 * بيضيف IP فريد وترويسة الـ CSRF تلقائيًا.
 */
export function api(method: Method, path: string, token?: string) {
  const req = request(app)[method](path)
    .set("X-Forwarded-For", nextIp())
    .set("X-Requested-With", "devconnect");
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

export interface TestUser {
  token: string;
  username: string;
  email: string;
  id: string;
  refreshCookie: string | null;
}

/** بيستخرج كوكي الـ refresh من رد supertest */
export function refreshCookieFrom(res: request.Response): string | null {
  const raw = res.headers["set-cookie"];
  const all: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const c = all.find((x) => x.startsWith("devconnect_refresh="));
  return c ? c.split(";")[0]!.slice("devconnect_refresh=".length) : null;
}

/**
 * بينشئ مستخدم اختباري.
 * ملاحظات على القيم: التسجيل مقصور على @devconnect.com، والـ DEVELOPER
 * لازم resumeUrl بامتداد .pdf وعلى مضيف Cloudinary (BUG-11).
 */
export async function registerUser(handle: string): Promise<TestUser> {
  const username = `${handle}_${TAG}`.slice(0, 30);
  const email = `${username}@devconnect.com`;
  const res = await api("post", "/api/auth/register").send({
    email,
    username,
    password: "supersecret1",
    displayName: handle,
    yearsExperience: 3,
    resumeUrl: "https://res.cloudinary.com/demo/raw/upload/cv.pdf",
  });
  if (res.status !== 201) {
    throw new Error(`registerUser(${handle}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    token: res.body.token,
    username,
    email,
    id: res.body.user.id,
    refreshCookie: refreshCookieFrom(res),
  };
}

/** رابط Cloudinary صالح — بيعدي من فحص BUG-11 */
export const CLOUDINARY_URL = "https://res.cloudinary.com/demo/image/upload/v1/pic.jpg";

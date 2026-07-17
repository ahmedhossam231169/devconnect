// ---------------------------------------------------------------
// كوكي الـ refresh token
//
// ليه كوكي مش localStorage: ده التوكن طويل العمر. لو اتحط في localStorage
// أي ثغرة XSS بتقراه وتاخد جلسة كاملة، وساعتها الـ refresh مابيضيفش أمان
// على الـ JWT الطويل اللي كان موجود. httpOnly بيخلي الجافاسكريبت مش شايفاه
// أصلاً. الـ access token القصير هو بس اللي بيفضل في متناول الصفحة.
// ---------------------------------------------------------------
import type { Request, Response } from "express";
import { config } from "./config.js";
import { Errors } from "./errors.js";

export const REFRESH_COOKIE = "devconnect_refresh";

// المسار محصور على /api/auth: الكوكي مايتبعتش مع كل طلب للـ API، بس مع
// endpoints الجلسة. أقل تعرّض من غير أي تكلفة.
const COOKIE_PATH = "/api/auth";

/**
 * في الإنتاج sameSite=none + secure.
 *
 * "none" مش تراخي — هو الشرط عشان الكوكي يشتغل لما الـ client والـ API على
 * دومينين مختلفين (زي vercel.app مع onrender.com دلوقتي). ولو اتحطوا على
 * نفس الدومين (api.example.com + example.com) الكوكي بيفضل first-party
 * وبيشتغل عادي برضه — يعني الإعداد ده صح في الحالتين.
 *
 * ⚠️ بس Safari بيحجب كوكيز الطرف التالت افتراضيًا، وChrome ماشي في نفس
 * الاتجاه. يعني طول ما الـ client والـ API على دومينين مختلفين، التجديد
 * هيفشل عند مستخدمي Safari وهيتسجّل خروجهم كل 15 دقيقة. الحل مش إعداد
 * كوكي — الحل إن الـ API يبقى على نفس الدومين (شوف DEPLOYMENT.md).
 *
 * في التطوير: localhost:5173 و localhost:4000 نفس الـ site (البورت مش
 * بيفرق في حساب الـ site)، فـ lax بتكفي، وsecure لازم تبقى false لأن
 * مفيش https محلي.
 */
function cookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: (config.isProd ? "none" : "lax") as "none" | "lax",
    path: COOKIE_PATH,
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export function setRefreshCookie(res: Response, raw: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, raw, cookieOptions(expiresAt));
}

export function clearRefreshCookie(res: Response): void {
  // لازم نفس الـ path والخصائص، وإلا المتصفح مش هيلاقي الكوكي ليمسحه
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

export function readRefreshCookie(req: Request): string | null {
  // قراءة يدوية — نفس أسلوب كوكي الـ OAuth state، مش محتاجين cookie-parser
  const match = (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(REFRESH_COOKIE.length + 1)) : null;
}

/**
 * حماية CSRF لـ endpoints الجلسة.
 *
 * sameSite=none في الإنتاج معناها إن المتصفح هيبعت الكوكي مع طلب جاي من أي
 * موقع. من غير الفحص ده، موقع خبيث يقدر يخلي متصفح الضحية يـ POST على
 * /api/auth/refresh. هو مش هيقدر يقرا الرد (الـ CORS بيمنعه) بس هيدوّر
 * التوكن ويكسر جلسة الضحية.
 *
 * الترويسة المخصّصة دي بتجبر المتصفح على preflight، والـ preflight بيفشل
 * لأي origin مش في القايمة. مفيش نموذج HTML يقدر يبعت ترويسة مخصّصة.
 */
export function requireSessionHeader(req: Request): void {
  if (req.get("X-Requested-With") !== "devconnect") {
    throw Errors.forbidden("Missing X-Requested-With header");
  }
}

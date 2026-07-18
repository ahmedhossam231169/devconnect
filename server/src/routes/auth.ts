import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { Errors, AppError } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { registerSchema, loginSchema } from "../schemas/auth.js";
import { isLocked, recordFailedLogin, clearLoginThrottle } from "../lib/loginThrottle.js";
import { getAllowedOrigins } from "../lib/cors.js";
import { config } from "../lib/config.js";
import { authLimiter } from "../middleware/rateLimit.js";
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeByRawToken,
  revokeAllForUser,
  revokeFamily,
  listSessions,
  familyIdForRawToken,
  RefreshError,
} from "../lib/refreshTokens.js";
import {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  requireSessionHeader,
} from "../lib/refreshCookie.js";

export const authRouter = Router();

/** جلسة جديدة + الكوكي بتاعها. بيتنادى من كل مسار بيسجّل دخول. */
async function startSession(userId: string, req: Request, res: Response): Promise<void> {
  const { raw, expiresAt } = await issueRefreshToken(userId, req);
  setRefreshCookie(res, raw, expiresAt);
}

// ---------------------------------------------------------------
// [SECURITY] OAuth state — حماية من CSRF على الـ callback
// الـ state بقى self-validating: nonce.expiry.HMAC — السيرفر بيتحقق من
// التوقيع والصلاحية بدل الاعتماد الكامل على الكوكي. السبب: حماية الخصوصية
// في المتصفحات الحديثة (Chrome bounce tracking mitigation / Firefox ETP
// Strict) بتمسح كوكيز دومين الـ API لأنه بيستقبل navigation وبيعمل
// redirect فورًا من غير تفاعل — فالكوكي كانت بتضيع والدخول بيفشل
// بـ "state mismatch". الكوكي لسه بتتبعت، ولو وصلت لازم تطابق (حماية
// أقوى ضد login CSRF) — بس غيابها ما بيفشلش الـ flow.
// ---------------------------------------------------------------
import crypto from "node:crypto";
import type { Request, Response } from "express";

const OAUTH_STATE_COOKIE = "dc_oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 دقايق كافية لإتمام التدفق

function signOAuthState(payload: string): string {
  // config بيضمن وجوده وقت تشغيل السيرفر — مفيش داعي لفحص هنا
  // "oauth-state|" prefix عشان التوقيع ده مايتلبسش على أي استخدام تاني للسر
  return crypto.createHmac("sha256", config.JWT_SECRET).update(`oauth-state|${payload}`).digest("hex");
}

// الـ state بيشيل كمان "mode": يا "login" يا "link:<userId>" —
// عشان نفس الـ callback يخدم تسجيل الدخول وربط GitHub بحساب موجود
function issueOAuthState(res: Response, mode = "login"): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${nonce}.${Date.now() + OAUTH_STATE_TTL_MS}.${mode}`;
  const state = `${payload}.${signOAuthState(payload)}`;
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax", // lax عشان الكوكي يتبعت مع الـ redirect الراجع من GitHub/Google
    maxAge: OAUTH_STATE_TTL_MS,
    path: "/api/auth",
  });
  return state;
}

/** بيرجع الـ mode بتاع الـ state بعد التحقق ("login" أو "link:<userId>") */
function verifyOAuthState(req: Request, res: Response): string {
  const returned = String(req.query.state ?? "");
  // قراءة الكوكي يدويًا — مش محتاجين cookie-parser لكوكي واحد
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
  const stored = match ? decodeURIComponent(match.slice(OAUTH_STATE_COOKIE.length + 1)) : "";

  res.clearCookie(OAUTH_STATE_COOKIE, { path: "/api/auth" }); // يتستخدم مرة واحدة

  const mismatch = Errors.unauthorized("OAuth state mismatch. Please try signing in again.");

  // 1) التوقيع لازم يكون صح — ده بيمنع أي state متلفق أو متعدّل
  const parts = returned.split(".");
  if (parts.length < 4) throw mismatch;
  const sig = parts.pop()!;
  const payload = parts.join(".");
  const expected = signOAuthState(payload);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    throw mismatch;
  }
  const [, expStr, ...modeParts] = parts;
  const mode = modeParts.join(".");

  // 2) الصلاحية — الـ state القديم مايتقبلش (يحد من إعادة الاستخدام)
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    throw Errors.unauthorized("This sign-in attempt expired. Please try again.");
  }

  // 3) لو الكوكي وصلت لازم تطابق — لو اتمسحت (tracking protection) نكتفي بالتوقيع
  // في وضع link مش بنقارن: الـ state أصلًا مربوط بالـ userId بتوقيع HMAC،
  // وكوكي قديمة من محاولة login سابقة كانت بتعمل رفض غلط
  if (
    mode === "login" &&
    stored &&
    (returned.length !== stored.length ||
      !crypto.timingSafeEqual(Buffer.from(returned), Buffer.from(stored)))
  ) {
    throw mismatch;
  }

  return mode;
}

// اللي بنرجعه للـ client عن المستخدم — من غير passwordHash أبدًا
const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  role: true,
  createdAt: true,
  profile: {
    select: { displayName: true, avatarUrl: true, headline: true, onboarded: true },
  },
} as const;

// ---------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------
authRouter.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    // .parse بترمي ZodError لو في مشكلة → errorHandler بيحولها 422 تلقائي
    const input = registerSchema.parse(req.body);

    // فحص التكرار قبل الإنشاء عشان نرجع رسالة واضحة بدل DB error خام
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      throw Errors.conflict(
        existing.email === input.email
          ? "An account with this email already exists"
          : "This username is taken"
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    // بننشئ الـ User والـ Profile مع بعض في transaction ضمني (nested create)
    const user = await prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        passwordHash,
        role: input.role,
        profile: {
          create: {
            displayName: input.displayName,
            yearsExperience: input.yearsExperience,
            resumeUrl: input.resumeUrl ?? null,
          },
        },
      },
      select: publicUserSelect,
    });

    // [SECURITY BUG-05] مستخدم جديد → tokenVersion يبدأ من 0
    const token = signToken({ userId: user.id, role: user.role, tokenVersion: 0 });
    await startSession(user.id, req, res);
    res.status(201).json({ ok: true, user, token });
  })
);

// ---------------------------------------------------------------
// POST /api/auth/login  (email أو username)
// ---------------------------------------------------------------
authRouter.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: input.identifier }, { username: input.identifier }],
      },
    });

    // نفس الرسالة سواء الحساب مش موجود أو الباسورد غلط
    // عشان محدش يعرف يفحص أنهي إيميلات مسجلة عندنا (user enumeration)
    const invalidCreds = Errors.unauthorized("Invalid credentials");
    if (!user || !user.passwordHash) throw invalidCreds;

    // [SECURITY BUG-06] الحساب متقفل من كتر المحاولات الفاشلة؟
    // بنرجّع نفس رسالة "Invalid credentials" عن قصد مش رسالة "الحساب متقفل":
    // رسالة مميزة كانت هتبقى أداة enumeration (بتأكد إن الحساب موجود)، وده
    // بيهدم الحماية اللي الكود ده ماشي عليها في كل مكان. المستخدم العادي
    // مابيوصلش هنا أصلاً — بيقابل حد الـ IP (10) الأول برسالته الواضحة.
    if (isLocked(user)) throw invalidCreds;

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      await recordFailedLogin(user);
      throw invalidCreds;
    }

    // دخول ناجح → الحالة تتصفّر عشان محاولات قديمة متفرقة ما تتراكمش
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await clearLoginThrottle(user.id);
    }

    const publicUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: publicUserSelect,
    });

    const token = signToken({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion });
    // rememberMe بقى مالوش لازمة: كل الجلسات بقى عمرها 30 يوم بتتمدد مع كل
    // تجديد، والاستمرارية جاية من الـ refresh cookie. سايبينه في الـ schema
    // عشان الـ client الحالي لسه بيبعته — بيتتجاهل.
    await startSession(user.id, req, res);
    res.json({ ok: true, user: publicUser, token });
  })
);

// ---------------------------------------------------------------
// GET /api/auth/me — بيانات صاحب التوكن الحالي
// ---------------------------------------------------------------
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: publicUserSelect,
    });
    if (!user) throw Errors.unauthorized("Account no longer exists");
    res.json({ ok: true, user });
  })
);

// ---------------------------------------------------------------
// GitHub OAuth — خطوتين:
// 1) /github → بنحوّل المستخدم لصفحة GitHub
// 2) /github/callback → GitHub بيرجعنا بـ code، بنبدله بـ access token
//    وبنجيب بيانات المستخدم وبنعمل login أو نسجّله جديد
// محتاج GITHUB_CLIENT_ID و GITHUB_CLIENT_SECRET في الـ .env
// ---------------------------------------------------------------
authRouter.get("/github", (_req, res) => {
  const clientId = config.GITHUB_CLIENT_ID;
  if (!clientId) throw Errors.internal("GitHub OAuth is not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "read:user user:email",
    state: issueOAuthState(res), // [SECURITY] CSRF protection
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// ---------------------------------------------------------------
// GET /api/auth/github/connect-url — ربط GitHub بحساب مسجّل دخول بالفعل
// [SECURITY] عرض الـ repos بيتطلب إثبات ملكية حساب GitHub عن طريق OAuth —
// مش مجرد كتابة username — عشان محدش يعرض مشاريع حد تاني على إنها بتاعته.
// بنرجّع اللينك في JSON (مش redirect) لأن الطلب محتاج Authorization header.
// الـ state بيشيل userId موقّع بـ HMAC فالـ callback يعرف يربط مين.
// ---------------------------------------------------------------
authRouter.get("/github/connect-url", requireAuth, (req, res) => {
  const clientId = config.GITHUB_CLIENT_ID;
  if (!clientId) throw Errors.internal("GitHub OAuth is not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "read:user",
    state: issueOAuthState(res, `link:${req.user!.userId}`),
  });
  res.json({ ok: true, url: `https://github.com/login/oauth/authorize?${params}` });
});

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

authRouter.get(
  "/github/callback",
  asyncHandler(async (req, res) => {
    const mode = verifyOAuthState(req, res); // [SECURITY] لازم قبل أي حاجة تانية
    const code = String(req.query.code ?? "");
    if (!code) throw Errors.badRequest("Missing OAuth code");

    // 1) بدل الـ code بـ access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.GITHUB_CLIENT_ID,
        client_secret: config.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) throw Errors.unauthorized("GitHub authorization failed");

    // 2) هات بيانات المستخدم من GitHub API
    const ghRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const gh = (await ghRes.json()) as GitHubUser;

    // ---- وضع الربط: مستخدم مسجّل دخول بالفعل بيثبت ملكية حساب GitHub ----
    if (mode.startsWith("link:")) {
      const userId = mode.slice("link:".length);
      const clientUrl = getAllowedOrigins()[0];

      // الحساب ده مربوط بمستخدم تاني عندنا؟ → مانسمحش بالسرقة العكسية
      const taken = await prisma.user.findUnique({
        where: { githubId: String(gh.id) },
        select: { id: true },
      });
      if (taken && taken.id !== userId) {
        return res.redirect(`${clientUrl}/projects?github=already-linked`);
      }

      const me = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!me) return res.redirect(`${clientUrl}/projects?github=error`);

      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { githubId: String(gh.id) } }),
        prisma.profile.update({
          where: { userId },
          data: {
            githubUsername: gh.login,
            githubUrl: `https://github.com/${gh.login}`,
          },
        }),
      ]);
      return res.redirect(`${clientUrl}/projects?github=connected`);
    }

    // 3) لو مسجّل قبل كده → login. لو جديد → أنشئ حساب
    let user = await prisma.user.findUnique({ where: { githubId: String(gh.id) } });

    if (!user) {
      // [SECURITY] إيميل GitHub العام مش مضمون إنه مُتحقق منه، فما بنربطش
      // بيه حساب موجود (منع account takeover). لو الإيميل مستخدم بالفعل
      // بننشئ الحساب بإيميل noreply بدل ما نرمي unique-constraint error
      let email = gh.email ?? `${gh.login}@users.noreply.github.com`;
      if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
        email = `${gh.login}@users.noreply.github.com`;
      }

      // username ممكن يكون محجوز عندنا — نضيف لاحقة عشوائية لحد ما نلاقي فاضي
      let username = gh.login;
      while (await prisma.user.findUnique({ where: { username }, select: { id: true } })) {
        username = `${gh.login}_${crypto.randomBytes(2).toString("hex")}`;
      }

      user = await prisma.user.create({
        data: {
          email,
          username,
          githubId: String(gh.id),
          role: "DEVELOPER",
          profile: {
            create: {
              displayName: gh.name ?? gh.login,
              avatarUrl: gh.avatar_url,
              githubUrl: `https://github.com/${gh.login}`,
              githubUsername: gh.login,
            },
          },
        },
      });
    }

    const token = signToken({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion });
    // الكوكي بيتحط هنا وإحنا لسه على دومين الـ API في تنقل top-level، يعني
    // first-party وقت التخزين — المتصفح بيقبله حتى لو بيحجب كوكيز الطرف التالت
    await startSession(user.id, req, res);
    // بنرجّع المستخدم للـ frontend والتوكن في الـ URL (الـ client هيلقطه ويخزنه)
    // ده رابط redirect فعلي (مش CORS whitelist)، فبناخد أول دومين مسموح بس
    const clientUrl = getAllowedOrigins()[0];
    res.redirect(`${clientUrl}/auth/callback#token=${token}`); // [SECURITY] fragment مش بيتبعت للسيرفرات ولا بيتسجل في logs
  })
);

// ---------------------------------------------------------------
// POST /api/auth/forgot-password — الخطوة 1: طلب استعادة كلمة السر
// ---------------------------------------------------------------
import { z } from "zod";
import { sendEmail, passwordResetEmail, oauthAccountEmail } from "../lib/email.js";

const forgotSchema = z.object({ email: z.string().email("Enter a valid email") });
const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

authRouter.post(
  "/forgot-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email } = forgotSchema.parse(req.body);

    // [SECURITY BUG-07] الرد لازم يخرج قبل أي شغل بيعتمد على وجود الحساب.
    // الرسالة واحدة في كل الحالات، بس الوقت كان بيفضح:
    //   موجود  → كتابة داتابيز + SMTP (بطيء)
    //   مش موجود → مفيش (سريع)
    // فرق التوقيت لوحده كان بيخلي المهاجم يعدّ الإيميلات المسجلة حتى والرد
    // متطابق. بنرد الأول، وبعدها نعمل الشغل في الخلفية — فالتوقيت بقى ثابت.
    res.json({ ok: true, message: "If that email exists, a reset link has been sent." });

    // مفصول عن الرد عن قصد. أخطاؤه بتتسجل بس — مايقدرش يكتب على response
    // اتبعت خلاص، وأي throw هنا من غير catch بيبقى unhandled rejection.
    void sendResetEmail(email).catch((err) =>
      console.error(`[forgot-password] background send failed for a request:`, err)
    );
  })
);

/** شغل الاستعادة الفعلي — بيجري بعد ما الرد يخرج، عشان التوقيت يفضل ثابت */
async function sendResetEmail(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return; // مفيش حساب — مفيش حاجة تتبعت (والطالب مش هيعرف الفرق)

  if (user.passwordHash) {
    // توكن عشوائي: الأصلي بيتبعت في الإيميل، والـ hash بس بيتخزن — لو
    // الداتابيز اتسربت مايفتحش استعادة
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: tokenHash,
        resetTokenExpiry: new Date(Date.now() + 30 * 60 * 1000), // 30 دقيقة
      },
    });
    const clientUrl = getAllowedOrigins()[0];
    const mail = passwordResetEmail(`${clientUrl}/reset-password?token=${rawToken}`);
    await sendEmail(email, mail.subject, mail.html);
  } else {
    // حساب OAuth من غير باسورد: رابط الاسترداد مالوش لازمة — نوضّحله يدخل إزاي
    const provider = user.googleId ? "Google" : user.githubId ? "GitHub" : "a social login";
    const mail = oauthAccountEmail(provider);
    await sendEmail(email, mail.subject, mail.html);
  }
}

// ---------------------------------------------------------------
// POST /api/auth/reset-password — الخطوة 2: تعيين كلمة سر جديدة بالتوكن
// ---------------------------------------------------------------
authRouter.post(
  "/reset-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token, password } = resetSchema.parse(req.body);

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await prisma.user.findFirst({
      where: { resetTokenHash: tokenHash },
    });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw Errors.badRequest("This reset link is invalid or has expired. Request a new one.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetTokenHash: null, // التوكن بيتحرق بعد الاستخدام — مايتستخدمش مرتين
        resetTokenExpiry: null,
        // [SECURITY BUG-05] يبطّل كل الجلسات القديمة — أي JWT اتصدر قبل كده يترفض
        tokenVersion: { increment: 1 },
        // [SECURITY BUG-06] صاحب الحساب أثبت ملكيته للإيميل، فالقفل مالوش لازمة.
        // من غير ده مستخدم اتقفل عليه حسابه بهجوم موزّع كان هيفضل مقفول 15 دقيقة
        // حتى بعد ما يغيّر باسورده — يعني المهاجم يقدر يمنعه من الدخول باستمرار.
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
      },
    });

    // tokenVersion فوق بتبطّل الـ access tokens بس. من غير السطر ده، حد سرق
    // الحساب بيفضل ماسك refresh token شغال وبيجدّد بيه بعد ما الضحية تغيّر
    // الباسورد — يعني إعادة التعيين مابتطردهوش، وهي دي وظيفتها الأساسية.
    await revokeAllForUser(user.id);

    res.json({ ok: true, message: "Password updated. You can sign in now." });
  })
);

// ---------------------------------------------------------------
// Google OAuth — نفس فكرة GitHub بالظبط:
// 1) /google → تحويل لصفحة موافقة Google
// 2) /google/callback → نبدل الـ code بتوكن، نجيب البيانات، login أو تسجيل جديد
// محتاج GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET في الـ .env
// ---------------------------------------------------------------
// الـ callback URL لازم يطابق اللي مسجّل في Google Console بالحرف
const googleRedirectUri = () => `${config.SERVER_URL ?? `http://localhost:${config.PORT}`}/api/auth/google/callback`;

authRouter.get("/google", (_req, res) => {
  const clientId = config.GOOGLE_CLIENT_ID;
  if (!clientId) throw Errors.internal("Google OAuth is not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: issueOAuthState(res), // [SECURITY] CSRF protection
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

interface GoogleUser {
  sub: string; // الـ ID الثابت بتاع المستخدم عند Google
  email: string;
  name: string | null;
  picture: string | null;
}

authRouter.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    verifyOAuthState(req, res); // [SECURITY] لازم قبل أي حاجة تانية
    const code = String(req.query.code ?? "");
    if (!code) throw Errors.badRequest("Missing OAuth code");

    // قبل كده كان `?? ""` — يعني لو الإعداد ناقص كنا بنبعت client_id فاضي
    // لـ Google ونستنى رد غامض. دلوقتي بنفشل بسبب واضح.
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw Errors.internal("Google OAuth is not configured");
    }

    // 1) بدل الـ code بـ access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: googleRedirectUri(),
      }),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenData.access_token) {
      // جوجل بتقول السبب بالظبط (invalid_client / redirect_uri_mismatch / invalid_grant)
      // وقبل كده كنا برميه في الزبالة ونطلع "Google authorization failed" ملهاش أي دلالة.
      // بيروح للوجز بس — مش للمستخدم — عشان مانأكدش لمهاجم إن الـ client_id صح.
      // الـ client_id والـ redirect_uri الاتنين علنيين (بيبانوا في رابط الموافقة)،
      // وهما اللي بيحددوا بتكلم أنهي client بالظبط لما تبقى عندك أكتر من واحد.
      console.error(
        `[google-oauth] token exchange failed: ${tokenData.error ?? tokenRes.status} — ` +
          `${tokenData.error_description ?? "no description"} ` +
          `(redirect_uri=${googleRedirectUri()}, client_id=${config.GOOGLE_CLIENT_ID})`
      );
      throw Errors.unauthorized("Google authorization failed");
    }

    // 2) هات بيانات المستخدم
    const gRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const g = (await gRes.json()) as GoogleUser;

    // 3) login لو مسجل قبل كده، أو إنشاء حساب جديد
    let user = await prisma.user.findUnique({ where: { googleId: g.sub } });

    if (!user) {
      // لو نفس الإيميل متسجل بباسورد قبل كده → نربط حساب Google بيه بدل حساب مكرر
      const existingByEmail = await prisma.user.findUnique({ where: { email: g.email } });
      if (existingByEmail) {
        user = await prisma.user.update({
          where: { id: existingByEmail.id },
          data: { googleId: g.sub },
        });
      } else {
        // username من الإيميل + عشوائية بسيطة لتجنب التكرار
        const base = g.email.split("@")[0]!.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20) || "dev";
        let username = base;
        while (await prisma.user.findUnique({ where: { username } })) {
          username = `${base}_${crypto.randomBytes(2).toString("hex")}`;
        }
        user = await prisma.user.create({
          data: {
            email: g.email,
            username,
            googleId: g.sub,
            role: "DEVELOPER",
            profile: {
              create: {
                displayName: g.name ?? username,
                avatarUrl: g.picture,
              },
            },
          },
        });
      }
    }

    const token = signToken({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion });
    await startSession(user.id, req, res); // شوف الملاحظة في callback بتاع GitHub
    const clientUrl = getAllowedOrigins()[0];
    res.redirect(`${clientUrl}/auth/callback#token=${token}`); // [SECURITY] fragment مش بيتبعت للسيرفرات ولا بيتسجل في logs
  })
);

// ---------------------------------------------------------------
// POST /api/auth/refresh — access token جديد من الكوكي
// عام عن قصد: الـ access token القديم غالبًا خلص خلاص، فمينفعش نطلبه.
// الكوكي نفسه هو إثبات الهوية.
// ---------------------------------------------------------------
authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    requireSessionHeader(req); // CSRF — شوف lib/refreshCookie.ts

    const raw = readRefreshCookie(req);
    if (!raw) throw Errors.unauthorized("No session");

    try {
      const rotated = await rotateRefreshToken(raw, req);
      const token = signToken({
        userId: rotated.userId,
        role: rotated.role,
        tokenVersion: rotated.tokenVersion,
      });
      setRefreshCookie(res, rotated.raw, rotated.expiresAt);
      res.json({ ok: true, token });
    } catch (err) {
      if (err instanceof RefreshError) {
        // تاب تاني سبقنا للتجديد — الجلسة سليمة تمامًا. مابنمسحش الكوكي
        // (الجديد بتاعه موجود فيه أصلاً) وبنقول للعميل يعيد المحاولة.
        if (err.reason === "concurrent") {
          throw new AppError(409, "REFRESH_RETRY", "Refresh raced with another tab. Retry.");
        }
        // باقي الأسباب → نفس الرد ونمسح الكوكي. التفرقة بين "منتهي" و"متعاد
        // استخدامه" مابتفيدش العميل وبتوصف حالة داخلية لأي حد بيجرب.
        clearRefreshCookie(res);
        throw Errors.unauthorized("Session expired. Please sign in again.");
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------
// POST /api/auth/logout — تسجيل خروج الجهاز ده
// عام: التوكن ممكن يكون خلص، والخروج لازم يشتغل برضه.
// ---------------------------------------------------------------
authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    requireSessionHeader(req);
    const raw = readRefreshCookie(req);
    // بنبطّل الجلسة على السيرفر — ده اللي بيخلي الخروج حقيقي بدل ما يبقى
    // مجرد مسح من localStorage عند المستخدم بس
    if (raw) await revokeByRawToken(raw);
    clearRefreshCookie(res);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------
// GET /api/auth/sessions — الأجهزة الداخلة على الحساب
// ---------------------------------------------------------------
authRouter.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const raw = readRefreshCookie(req);
    // بنحلّه مرة واحدة قبل الـ map — استعلام واحد بدل واحد لكل جلسة
    const currentFamily = raw ? await familyIdForRawToken(raw) : null;
    const sessions = await listSessions(req.user!.userId);
    res.json({
      ok: true,
      sessions: sessions.map((s) => ({
        id: s.familyId,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        userAgent: s.userAgent,
        ip: s.ip,
        current: s.familyId === currentFamily,
      })),
    });
  })
);

// ---------------------------------------------------------------
// DELETE /api/auth/sessions/:id — تطليع جهاز بعينه
// ---------------------------------------------------------------
authRouter.delete(
  "/sessions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const familyId = req.params.id!;
    // لازم نتأكد إن العيلة دي بتاعت اليوزر ده — غير كده أي حد داخل يقدر
    // يطلّع أي حد تاني بمعرفة الـ familyId بتاعه
    const owned = await prisma.refreshToken.findFirst({
      where: { familyId, userId: req.user!.userId },
      select: { id: true },
    });
    if (!owned) throw Errors.notFound("Session");

    await revokeFamily(familyId);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------
// POST /api/auth/logout-all — تطليع كل الأجهزة
// ---------------------------------------------------------------
authRouter.post(
  "/logout-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const revoked = await revokeAllForUser(req.user!.userId);
    // tokenVersion كمان: الـ refresh tokens اتلغت، بس الـ access tokens
    // اللي في إيد الأجهزة التانية لسه صالحة لحد 15 دقيقة. البمب ده بيبطّلهم
    // فورًا — ده بالظبط الفرق بين "خروج" و"خروج دلوقتي حالًا".
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { tokenVersion: { increment: 1 } },
    });
    clearRefreshCookie(res);
    res.json({ ok: true, revoked });
  })
);

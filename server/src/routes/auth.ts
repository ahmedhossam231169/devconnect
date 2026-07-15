import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { registerSchema, loginSchema } from "../schemas/auth.js";
import { getAllowedOrigins } from "../lib/cors.js";
import { authLimiter } from "../middleware/rateLimit.js";

export const authRouter = Router();

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
  const secret = process.env.JWT_SECRET;
  if (!secret) throw Errors.internal("JWT_SECRET is not configured");
  // "oauth-state|" prefix عشان التوقيع ده مايتلبسش على أي استخدام تاني للسر
  return crypto.createHmac("sha256", secret).update(`oauth-state|${payload}`).digest("hex");
}

// الـ state بيشيل كمان "mode": يا "login" يا "link:<userId>" —
// عشان نفس الـ callback يخدم تسجيل الدخول وربط GitHub بحساب موجود
function issueOAuthState(res: Response, mode = "login"): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${nonce}.${Date.now() + OAUTH_STATE_TTL_MS}.${mode}`;
  const state = `${payload}.${signOAuthState(payload)}`;
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) throw invalidCreds;

    const publicUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: publicUserSelect,
    });

    const token = signToken(
      { userId: user.id, role: user.role, tokenVersion: user.tokenVersion },
      input.rememberMe ? "30d" : "7d"
    );
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
  const clientId = process.env.GITHUB_CLIENT_ID;
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
  const clientId = process.env.GITHUB_CLIENT_ID;
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
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
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

    const user = await prisma.user.findUnique({ where: { email } });

    // مهم: بنرجع نفس الرد سواء الإيميل موجود أو لأ
    // عشان محدش يقدر يفحص أنهي إيميلات متسجلة عندنا (user enumeration)
    if (user && user.passwordHash) {
      // بنولّد توكن عشوائي، بنبعت النسخة الأصلية في الإيميل
      // وبنخزن الـ hash بس في الداتابيز — لو حد سرق الداتابيز مايعرفش يستخدمه
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
      const resetLink = `${clientUrl}/reset-password?token=${rawToken}`;
      const mail = passwordResetEmail(resetLink);
      await sendEmail(email, mail.subject, mail.html);
    } else if (user && !user.passwordHash) {
      // حساب OAuth من غير باسورد: رابط الاسترداد مالوش لازمة — نوضّحله يدخل إزاي.
      // الرد للطالب زي ما هو تمامًا، فمفيش تسريب لوجود الحساب (نفس حماية الـ enumeration).
      const provider = user.googleId ? "Google" : user.githubId ? "GitHub" : "a social login";
      const mail = oauthAccountEmail(provider);
      await sendEmail(email, mail.subject, mail.html);
    }

    res.json({ ok: true, message: "If that email exists, a reset link has been sent." });
  })
);

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
      },
    });

    res.json({ ok: true, message: "Password updated. You can sign in now." });
  })
);

// ---------------------------------------------------------------
// Google OAuth — نفس فكرة GitHub بالظبط:
// 1) /google → تحويل لصفحة موافقة Google
// 2) /google/callback → نبدل الـ code بتوكن، نجيب البيانات، login أو تسجيل جديد
// محتاج GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET في الـ .env
// ---------------------------------------------------------------
authRouter.get("/google", (_req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw Errors.internal("Google OAuth is not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.SERVER_URL || "http://localhost:4000"}/api/auth/google/callback`,
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

    // 1) بدل الـ code بـ access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: `${process.env.SERVER_URL || "http://localhost:4000"}/api/auth/google/callback`,
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) throw Errors.unauthorized("Google authorization failed");

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
    const clientUrl = getAllowedOrigins()[0];
    res.redirect(`${clientUrl}/auth/callback#token=${token}`); // [SECURITY] fragment مش بيتبعت للسيرفرات ولا بيتسجل في logs
  })
);

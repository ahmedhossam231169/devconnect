// ---------------------------------------------------------------
// إعدادات التطبيق — مصدر الحقيقة الوحيد لأي قيمة جاية من الـ environment
//
// ليه الملف ده موجود:
// قبل كده كل ملف كان بيقرأ process.env بنفسه وبيحط قيمة افتراضية لو ملقاش حاجة.
// النتيجة إن السيرفر كان بيقوم عادي في الإنتاج بإعدادات غلط — أخطرها إن
// CLIENT_URL كان بياخد "http://localhost:5173" تلقائي، يعني الـ CORS يتكسر
// والـ OAuth يحاول يرجّع اليوزرس على لوكال هوست بتاعهم. مكنتش هتكتشفها غير
// قدام الناس.
//
// دلوقتي: كل المتغيرات بتتقرأ وتتحقق هنا مرة واحدة وقت التشغيل. لو في حاجة
// غلط السيرفر ما بيقومش أصلاً وبيقول بالظبط إيه الناقص.
//
// ⚠️ مهم: الملف ده لازم يتحمّل قبل أي حاجة تانية بتقرأ env (شوف index.ts).
// ---------------------------------------------------------------
import "dotenv/config";
import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

/** رابط http(s) صالح — بنرفض أي بروتوكول تاني (javascript:, file: ...) */
const httpUrl = z
  .string()
  .url("must be a valid URL")
  .refine((v) => /^https?:\/\//i.test(v), "must start with http:// or https://");

/** بيمنع الإعدادات المحلية إنها تعدّي للإنتاج بالغلط */
const notLocalhostInProd = (v: string) =>
  !isProd || !/localhost|127\.0\.0\.1/i.test(v) || "must not point at localhost in production";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().max(65535).default(4000),

    // ---- الداتابيز ----
    DATABASE_URL: z.string().min(1, "is required").startsWith("postgresql://", "must be a postgresql:// URL"),
    // اتصال مباشر من غير pooler — للميجريشنز بس. prisma بيقراه من الـ schema
    // مش من هنا، بس بنتحقق منه عشان الغلط يبان بدري مش وقت الـ deploy.
    DIRECT_DATABASE_URL: z
      .string()
      .startsWith("postgresql://", "must be a postgresql:// URL")
      .optional(),

    // ---- الأمان ----
    // 32 حرف هو الحد الأدنى المعقول لـ HMAC-SHA256. ولّده بـ: openssl rand -base64 48
    JWT_SECRET: z.string().min(32, "must be at least 32 characters — generate with: openssl rand -base64 48"),

    // عدد الـ proxies الموثوقة قدام التطبيق. بيتحط في app.set("trust proxy").
    // القيمة دي بتحدد إزاي بنعرف IP المستخدم الحقيقي، واللي عليه الـ rate limiting.
    // غلط هنا = تجاوز الـ rate limit (شوف SECURITY_AUDIT.md / BUG-06).
    //   false = التطبيق متعرض مباشرة من غير أي proxy
    //   1     = بروكسي واحد بالظبط (nginx / Render / Railway)
    //   2+    = عدد الـ hops (مثلاً Cloudflare + nginx = 2)
    TRUST_PROXY: z
      .union([z.coerce.number().int().min(0).max(10), z.enum(["false", "true"])])
      .default(isProd ? 1 : "false")
      .transform((v) => (v === "false" ? false : v === "true" ? true : v)),

    // ---- الروابط ----
    // قايمة origins مفصولة بفاصلة. أول واحد هو اللي بيتستخدم في redirects الـ OAuth.
    CLIENT_URL: z.string().min(1, "is required").optional(),
    SERVER_URL: httpUrl.optional(),

    // ---- OAuth (اختياري — بس لو حطيت واحد لازم تحط اللي معاه) ----
    // .trim() مش تجميل: الأسرار دي بتتنسخ بالإيد من لوحات جوجل/جيت هب وبتتلزق
    // في لوحة Render، والنسخة بتجيب معاها مسافة أو سطر جديد في الآخر كتير.
    // المسافة دي بتتبعت للـ provider جوا الطلب فيرفضه بـ invalid_client — وهو
    // نفس الرد بالظبط اللي بيجي لو السر غلط أصلاً، فبتفضل تغيّر سر صح بسر صح
    // والمشكلة مكانها. مفيش سر شرعي بيبدأ أو بينتهي بمسافة، فالتنضيف آمن.
    GITHUB_CLIENT_ID: z.string().trim().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().trim().min(1).optional(),
    GITHUB_TOKEN: z.string().trim().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),

    // اسم حساب Cloudinary بتاعنا. الرفع بيحصل من الـ client، والـ API بيخزن
    // الروابط بس — فبنستخدم ده عشان نتأكد إن الروابط دي بتشاور على حسابنا
    // إحنا مش على أي سيرفر تاني (schemas/profile.ts → cloudinaryUrl).
    // لو مش متظبط، الفحص بيرجع لمضيف res.cloudinary.com بس (شوف BUG-11).
    CLOUDINARY_CLOUD_NAME: z.string().trim().min(1).optional(),

    // ---- SMTP (اختياري — من غيره إيميلات الاستعادة بتتطبع في الـ logs) ----
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(1).default("DevConnect <no-reply@devconnect.app>"),

    // مفتاح أمان للتشغيل المحلي: بيجبر الإيميلات إنها تتطبع في الـ console
    // حتى لو SMTP متظبط. الداعي: ملفات الاختبار بتضرب endpoints بتبعت إيميل
    // (زي forgot-password) عشرات المرات — ومن غير المفتاح ده بتتبعت رسايل
    // حقيقية من حساب SMTP الحقيقي لعناوين وهمية، فبتاكل الرصيد وترفع نسبة
    // الارتداد اللي بتضر سمعة المُرسِل. شغّل السويتات بـ EMAIL_DISABLED=1.
    EMAIL_DISABLED: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((v) => v === "1" || v === "true"),
  })
  // في الإنتاج مفيش fallbacks — لازم تتحط صراحة
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, why: string) => {
      if (!env[key]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `is required in production — ${why}` });
      }
    };

    if (env.NODE_ENV === "production") {
      require("CLIENT_URL", "CORS and OAuth redirects depend on it");
      require("SERVER_URL", "the OAuth callback URL is built from it");
      require("DIRECT_DATABASE_URL", "prisma migrate cannot run through a connection pooler");
    }

    // الروابط لازم تكون صالحة، والـ localhost ممنوع في الإنتاج
    if (env.CLIENT_URL) {
      for (const origin of env.CLIENT_URL.split(",").map((s) => s.trim()).filter(Boolean)) {
        const parsed = httpUrl.safeParse(origin);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["CLIENT_URL"],
            message: `contains an invalid origin "${origin}" — each entry ${parsed.error.issues[0]!.message}`,
          });
          continue;
        }
        const ok = notLocalhostInProd(origin);
        if (ok !== true) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CLIENT_URL"], message: ok });
      }
    }
    if (env.SERVER_URL) {
      const ok = notLocalhostInProd(env.SERVER_URL);
      if (ok !== true) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SERVER_URL"], message: ok });
    }

    // الأزواج: واحد من غير التاني معناه إعداد ناقص هيفشل وقت الاستخدام مش وقت التشغيل
    const pair = (a: keyof typeof env, b: keyof typeof env) => {
      if (!!env[a] !== !!env[b]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [env[a] ? b : a],
          message: `is required when ${env[a] ? a : b} is set — set both or neither`,
        });
      }
    };
    pair("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");
    pair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");

    // التسجيل بالإيميل/الباسورد مقصور على @devconnect.com (schemas/auth.ts)،
    // يعني OAuth هو المسار الوحيد اللي أي حد من بره يقدر يعمل بيه حساب.
    // من غير أي provider متظبط، الإنتاج بيطلع من غير أي طريقة تسجيل للناس —
    // وده النوع اللي مش بتكتشفه غير لما يشتكيلك حد إنه مش قادر يسجّل.
    if (env.NODE_ENV === "production" && !env.GITHUB_CLIENT_ID && !env.GOOGLE_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GITHUB_CLIENT_ID"],
        message:
          "at least one OAuth provider (GitHub or Google) must be configured in production — " +
          "email/password sign-up is restricted to @devconnect.com, so OAuth is the only way the public can register",
      });
    }

    // SMTP: الهوست من غير بيانات دخول = إيميلات هتفشل بصمت
    if (env.SMTP_HOST && (!env.SMTP_USER || !env.SMTP_PASS)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_USER"],
        message: "SMTP_USER and SMTP_PASS are required when SMTP_HOST is set",
      });
    }
  });

// اصطلاح المشروع (زي ما هو في .env.example): FOO="" معناها "مش متظبط"، مش
// "قيمة فاضية". من غير التنظيف ده أي متغير اختياري سايب فاضي كان هيمنع السيرفر
// من إنه يقوم.
const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));

const parsed = schema.safeParse(rawEnv);

if (!parsed.success) {
  // بنطبع أسماء المتغيرات والمشكلة بس — القيم نفسها عمرها ما تتطبع (أسرار)
  const lines = parsed.error.issues.map((i) => `  ✗ ${i.path.join(".") || "(root)"} ${i.message}`);
  console.error(
    ["", "❌ Invalid environment configuration:", ...lines, "", "  See server/.env.example for the full reference.", ""].join("\n")
  );
  process.exit(1);
}

export const config = Object.freeze({
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  /**
   * الـ origins المسموح لها — بيتستخدم في CORS بتاع Express و Socket.io عشان
   * الاتنين يتفقوا. أول واحد هو الأساسي (بيتستخدم في redirects الـ OAuth
   * وروابط الإيميل) لأنه مقدرش يبقى قايمة.
   */
  allowedOrigins: (parsed.data.CLIENT_URL ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /**
   * فيه SMTP متظبط؟ لو لأ الإيميلات بتتطبع في الـ console بدل ما تتبعت.
   * EMAIL_DISABLED بتغلبه عشان التشغيل المحلي مايبعتش بريد حقيقي.
   */
  hasSmtp:
    !parsed.data.EMAIL_DISABLED &&
    !!(parsed.data.SMTP_HOST && parsed.data.SMTP_USER && parsed.data.SMTP_PASS),
});

// تحذير مش خطأ: من غير اسم الحساب، فحص روابط الرفع بيرجع لمضيف Cloudinary
// بس — بيمنع أي سيرفر تاني، لكن بيسمح بحسابات Cloudinary تانية. في الإنتاج
// ده لازم يتظبط عشان القيد يكمل. مش بنوقف السيرفر عشان ما نكسرش deploy قايم.
if (config.isProd && !config.CLOUDINARY_CLOUD_NAME) {
  console.warn(
    "⚠️  CLOUDINARY_CLOUD_NAME is not set — upload URLs are only checked for the res.cloudinary.com host, " +
      "not tied to your account. Set it to close BUG-11 fully."
  );
}

export type Config = typeof config;

import { z } from "zod";
import { config } from "../lib/config.js";

// [SECURITY] z.string().url() لوحدها بتقبل سكيمات زي javascript: و data:
// واللينكات دي بتتعرض في href على البروفايل → stored XSS
// فبنقصر الروابط على http/https بس
export const httpUrl = (message = "Enter a valid URL") =>
  z
    .string()
    .url(message)
    .refine((v) => /^https?:\/\//i.test(v), { message: "Only http(s) links are allowed" });

// [SECURITY BUG-11] الحقول اللي بتتعرض كصورة/مرفق لمستخدمين تانيين (الأفاتار،
// البانر، صورة البوست، مرفق الرسالة، الـ CV) لازم تكون من رفعنا إحنا على
// Cloudinary — مش أي رابط http(s). من غير القيد ده مستخدم يقدر يحط avatarUrl
// على سيرفر بيتحكم فيه، وساعتها متصفح أي حد بيفتح البروفايل بيجيب الصورة من
// هناك (تسريب IP + تتبّع)، وكمان بيتخطى Cloudinary تمامًا (مفيش حد أقصى حجم
// ولا أي إشراف على المحتوى).
//
// ملاحظة: websiteUrl و githubUrl مش بيمروا على ده — دول روابط خارجية شرعية
// للمستخدم، وبيتعرضوا كـ href (بيتضغطوا، مش بيتجابوا تلقائي) فخطرهم أقل.
export const cloudinaryUrl = (message = "Upload the file through the app") =>
  httpUrl(message).refine((v) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      return false;
    }
    // مضيف تسليم الأصول في Cloudinary — الرفع بيروح api.cloudinary.com والأصل
    // بيتسلّم من res.cloudinary.com/<cloud_name>/...
    if (u.hostname !== "res.cloudinary.com") return false;
    const cloud = config.CLOUDINARY_CLOUD_NAME;
    if (!cloud) return true; // مش متظبط (dev/test) → فحص المضيف يكفي
    // أول جزء في المسار لازم يكون اسم الحساب بتاعنا
    return u.pathname.slice(1).split("/")[0] === cloud;
  }, { message });

// [SECURITY BUG-08] اسم العرض بيتحقن في subject الإيميل، والـ subject header.
// سطر جديد جواه معناه حقن headers (Bcc/Reply-To) في إيميل طالع باسمنا.
// بنمنعها من المصدر — مفيش اسم عرض شرعي فيه سطر جديد أو محرف تحكم.
//
// بنمنع \p{Cc} (محارف التحكم) بس، مش \p{Cf}: الأخيرة فيها علامات اتجاه
// النص (RLM/LRM) اللي بتستخدم شرعيًا في الأسماء العربية والعبرية.
//
// ⚠️ ده بيغطي مسار التسجيل/تعديل البروفايل بس — أسماء OAuth بتتخزن من غير
// ما تعدي من هنا، فالتعقيم في lib/email.ts هو اللي بيغطيها.
export const displayName = z
  .string()
  .trim()
  .min(2, "Display name is too short")
  .max(60, "Display name is too long")
  .regex(/^[^\p{Cc}]*$/u, "Display name can't contain line breaks or control characters");

export const SPECIALTIES = [
  "Frontend", "Backend", "Full Stack", "DevOps", "Mobile",
  "AI/ML", "Data Engineer", "UI/UX", "QA/Testing", "Security",
] as const;

// ---------------------------------------------------------------
// تحديث البروفايل — بيانات المطور، وأهمها اللي فلتر الـ HR هيشتغل عليه
// ---------------------------------------------------------------
export const updateProfileSchema = z.object({
  displayName: displayName.optional(),
  headline: z.string().max(120).optional(),
  bio: z.string().max(1000).optional(),
  location: z.string().max(100).optional(),
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
  specialty: z.enum(SPECIALTIES).optional(),
  availability: z.enum(["OPEN_TO_WORK", "NOT_LOOKING", "FREELANCE_ONLY"]).optional(),
  // [SECURITY BUG-01] موافقة الظهور للـ recruiters في talent search
  discoverable: z.boolean().optional(),
  // روابط خارجية شرعية للمستخدم — أي http(s)
  websiteUrl: httpUrl().or(z.literal("")).optional(),
  githubUrl: httpUrl().or(z.literal("")).optional(),
  // حقول مرفوعة — لازم تكون على Cloudinary بتاعنا (BUG-11)
  avatarUrl: cloudinaryUrl().or(z.literal("")).optional(),
  bannerUrl: cloudinaryUrl().or(z.literal("")).optional(),
  resumeUrl: cloudinaryUrl().or(z.literal("")).optional(),
  // الخبرات الوظيفية — بنستبدل القايمة كلها (نفس أسلوب الـ skills)
  experiences: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        company: z.string().min(1).max(80),
        startYear: z.coerce.number().int().min(1970).max(2100),
        endYear: z.coerce.number().int().min(1970).max(2100).nullable().optional(),
        description: z.string().max(500).optional(),
      })
    )
    .max(15, "Too many experiences")
    .optional(),
  // الـ skills بتتبعت كـ array من { name, years } — بنعمل upsert لكل واحدة
  skills: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        years: z.coerce.number().int().min(0).max(40).default(0),
      })
    )
    .max(30, "Too many skills — keep the top ones")
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------------------------------------------------------------
// فلتر الـ HR — كل حقل اختياري، الـ backend بيبني query ديناميكي عليها
// ---------------------------------------------------------------
export const talentSearchSchema = z.object({
  q: z.string().max(100).optional(), // بحث بالاسم أو الـ username
  specialty: z.enum(SPECIALTIES).optional(),
  minYears: z.coerce.number().int().min(0).max(60).optional(),
  maxYears: z.coerce.number().int().min(0).max(60).optional(),
  skills: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(), // ?skills=React&skills=TypeScript
  availability: z.enum(["OPEN_TO_WORK", "NOT_LOOKING", "FREELANCE_ONLY"]).optional(),
  location: z.string().max(100).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(50).default(12),
});

export type TalentSearchInput = z.infer<typeof talentSearchSchema>;

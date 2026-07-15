import { z } from "zod";

// [SECURITY] z.string().url() لوحدها بتقبل سكيمات زي javascript: و data:
// واللينكات دي بتتعرض في href على البروفايل → stored XSS
// فبنقصر الروابط على http/https بس
export const httpUrl = (message = "Enter a valid URL") =>
  z
    .string()
    .url(message)
    .refine((v) => /^https?:\/\//i.test(v), { message: "Only http(s) links are allowed" });

export const SPECIALTIES = [
  "Frontend", "Backend", "Full Stack", "DevOps", "Mobile",
  "AI/ML", "Data Engineer", "UI/UX", "QA/Testing", "Security",
] as const;

// ---------------------------------------------------------------
// تحديث البروفايل — بيانات المطور، وأهمها اللي فلتر الـ HR هيشتغل عليه
// ---------------------------------------------------------------
export const updateProfileSchema = z.object({
  displayName: z.string().min(2, "Display name is too short").max(60).optional(),
  headline: z.string().max(120).optional(),
  bio: z.string().max(1000).optional(),
  location: z.string().max(100).optional(),
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
  specialty: z.enum(SPECIALTIES).optional(),
  companyName: z.string().trim().min(2, "Company name is too short").max(100).optional(),
  availability: z.enum(["OPEN_TO_WORK", "NOT_LOOKING", "FREELANCE_ONLY"]).optional(),
  // [SECURITY BUG-01] موافقة الظهور للـ recruiters في talent search
  discoverable: z.boolean().optional(),
  websiteUrl: httpUrl().or(z.literal("")).optional(),
  githubUrl: httpUrl().or(z.literal("")).optional(),
  avatarUrl: httpUrl().or(z.literal("")).optional(),
  bannerUrl: httpUrl().or(z.literal("")).optional(),
  resumeUrl: httpUrl().or(z.literal("")).optional(),
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

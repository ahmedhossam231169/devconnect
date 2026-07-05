import { z } from "zod";

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
  availability: z.enum(["OPEN_TO_WORK", "NOT_LOOKING", "FREELANCE_ONLY"]).optional(),
  websiteUrl: z.string().url("Enter a valid URL").or(z.literal("")).optional(),
  githubUrl: z.string().url("Enter a valid URL").or(z.literal("")).optional(),
  avatarUrl: z.string().url().or(z.literal("")).optional(),
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

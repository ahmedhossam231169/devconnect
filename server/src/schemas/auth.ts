import { z } from "zod";
import { cloudinaryUrl, displayName } from "./profile.js";

// التسجيل بالإيميل/الباسورد من الويب سايت مقصور على إيميلات الشركة.
// GitHub/Google بيعملوا حساب من مسار تاني (auth callbacks) فمش بيمروا على الـ schema ده.
export const COMPANY_EMAIL_DOMAIN = "devconnect.com";

// قواعد الـ username: حروف وأرقام و - و _ بس (هيظهر في الـ URL بتاع البروفايل)
const username = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, - and _ are allowed");

export const registerSchema = z
  .object({
    email: z
      .string()
      .email("Enter a valid email")
      .refine((e) => e.toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN}`), {
        message: `Sign-up is restricted to @${COMPANY_EMAIL_DOMAIN} email addresses`,
      }),
    username,
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: z.enum(["DEVELOPER", "RECRUITER"]).default("DEVELOPER"),
    displayName,
    // سنين الخبرة إلزامية للاتنين (Developer و Recruiter)
    yearsExperience: z.coerce
      .number()
      .int("Must be a whole number")
      .min(0, "Can't be negative")
      .max(60, "That doesn't look right"),
    // الـ CV إلزامي لل Developer بس — لينك PDF من Cloudinary بعد رفعه في الفورم.
    // لازم يكون على حسابنا (BUG-11)، والـ .pdf بيتفحص تحت في superRefine.
    resumeUrl: cloudinaryUrl("Upload your resume first").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "DEVELOPER") {
      if (!data.resumeUrl) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resumeUrl"], message: "Resume (PDF) is required" });
      } else if (!/\.pdf($|\?)/i.test(data.resumeUrl)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resumeUrl"], message: "Resume must be a PDF file" });
      }
    }
  });

export const loginSchema = z.object({
  // بنسمح بالدخول بالإيميل أو الـ username — زي الـ mockup بالظبط
  identifier: z.string().min(3, "Enter your email or username"),
  password: z.string().min(1, "Password is required"),
  // "Keep me signed in for 30 days" — بيطوّل عمر التوكن من 7 لـ 30 يوم
  rememberMe: z.boolean().optional().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

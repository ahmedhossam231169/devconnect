import { z } from "zod";
import { cloudinaryUrl } from "./profile.js";

const baseFields = {
  title: z.string().max(120, "Title is too long").optional(),
  body: z.string().min(1, "Post body is required").max(5000, "Post is too long"),
  // صورة مرفقة — لازم تكون من رفعنا على Cloudinary، مش أي رابط (BUG-11).
  // بتتعرض كـ src في فيد كل الناس، فأي رابط خارجي = تتبّع لكل من يشوف البوست.
  imageUrl: cloudinaryUrl().optional(),
};

// discriminatedUnion: قواعد مختلفة حسب نوع البوست
// SNIPPET لازم يكون معاه كود ولغة — TEXT و QUESTION لأ
export const createPostSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TEXT"), ...baseFields }),
  z.object({ type: z.literal("QUESTION"), ...baseFields }),
  // مشاركة مشروع — العنوان اسم المشروع، والوصف/اللينكات في الـ body (زر + Project في الديزاين)
  z.object({ type: z.literal("PROJECT"), ...baseFields }),
  z.object({
    type: z.literal("SNIPPET"),
    ...baseFields,
    // اللغة بقت نص حر يكتبه المستخدم بنفسه — مش قائمة مقفولة
    codeLanguage: z
      .string()
      .trim()
      .min(1, "Language is required")
      .max(30, "Language name is too long"),
    codeContent: z
      .string()
      .min(1, "Snippet code is required")
      .max(10_000, "Snippet is too long"),
    // البوست ده طالب مساعدة على الكود؟ (بادج Help Wanted)
    wantsHelp: z.boolean().optional().default(false),
  }),
]);

export const createCommentSchema = z.object({
  body: z.string().min(1, "Comment can't be empty").max(2000, "Comment is too long"),
});

export const createRepostSchema = z.object({
  comment: z.string().max(500, "Quote is too long").optional(),
});

// query params بتاعة الـ feed — بنعمل لها validation برضه
export const feedQuerySchema = z.object({
  // relevant = بوستات أصدقائك واللي بتتابعهم وكوميونتيهاتك بس (تاب Relevant في الديزاين)
  sort: z.enum(["relevant", "latest", "top"]).default("latest"),
  cursor: z.string().optional(), // id آخر بوست في الصفحة اللي فاتت
  take: z.coerce.number().int().min(1).max(50).default(10),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

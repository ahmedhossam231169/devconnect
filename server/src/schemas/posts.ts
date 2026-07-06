import { z } from "zod";

// اللغات المدعومة في الـ code snippets — نفس اللي هنعمله highlighting في الـ client
export const SNIPPET_LANGUAGES = [
  "javascript", "typescript", "python", "rust", "go",
  "java", "csharp", "cpp", "php", "ruby", "sql", "bash", "json", "css", "html",
] as const;

const baseFields = {
  title: z.string().max(120, "Title is too long").optional(),
  body: z.string().min(1, "Post body is required").max(5000, "Post is too long"),
  imageUrl: z.string().url().optional(), // صورة مرفقة (Cloudinary)
};

// discriminatedUnion: قواعد مختلفة حسب نوع البوست
// SNIPPET لازم يكون معاه كود ولغة — TEXT و QUESTION لأ
export const createPostSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TEXT"), ...baseFields }),
  z.object({ type: z.literal("QUESTION"), ...baseFields }),
  z.object({
    type: z.literal("SNIPPET"),
    ...baseFields,
    codeLanguage: z.enum(SNIPPET_LANGUAGES),
    codeContent: z
      .string()
      .min(1, "Snippet code is required")
      .max(10_000, "Snippet is too long"),
  }),
]);

export const createCommentSchema = z.object({
  body: z.string().min(1, "Comment can't be empty").max(2000, "Comment is too long"),
});

// query params بتاعة الـ feed — بنعمل لها validation برضه
export const feedQuerySchema = z.object({
  sort: z.enum(["latest", "top"]).default("latest"),
  cursor: z.string().optional(), // id آخر بوست في الصفحة اللي فاتت
  take: z.coerce.number().int().min(1).max(50).default(10),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

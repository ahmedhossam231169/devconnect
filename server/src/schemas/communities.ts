import { z } from "zod";
import { httpUrl } from "./profile.js";

export const COMMUNITY_CATEGORIES = [
  "Frontend", "Backend", "AI & ML", "DevOps", "Mobile", "Data",
] as const;

export const createCommunitySchema = z.object({
  name: z.string().min(3, "Name is too short").max(60, "Name is too long"),
  description: z.string().max(300).optional(),
  category: z.enum(COMMUNITY_CATEGORIES),
  // صور الكارت في الـ Hub (الديزاين الجديد) — اختيارية، والبديل gradient بالفئة
  avatarUrl: httpUrl().or(z.literal("")).optional(),
  coverUrl: httpUrl().or(z.literal("")).optional(),
  isPrivate: z.boolean().optional(),
});

export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;

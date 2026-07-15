import { z } from "zod";

export const translateSchema = z.object({
  text: z.string().min(1, "Text is required").max(5000, "Text is too long"),
  target: z.enum(["en", "ar"]),
});

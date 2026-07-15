import { Router } from "express";
import translate from "translate";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { translateSchema } from "../schemas/translate.js";

translate.engine = "libre"; // مكتبة مجانية بدون API key مدفوع

export const translateRouter = Router();

// ---------------------------------------------------------------
// POST /api/translate — ترجمة نص بوست بين العربي والإنجليزي
// ---------------------------------------------------------------
translateRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { text, target } = translateSchema.parse(req.body);

    let translated: string;
    try {
      translated = await translate(text, { to: target });
    } catch {
      throw Errors.badRequest("Couldn't translate this text right now");
    }

    res.json({ ok: true, translated });
  })
);

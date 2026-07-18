import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

// شكل الـ error response الموحد في المشروع كله:
// { ok: false, error: { code, message, details? } }
interface ErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// wrapper بيلقط أي error في الـ async routes ويبعته للـ handler
// من غيره: أي throw جوه async route هيعمل unhandled rejection
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/**
 * أخطاء body-parser بتيجي بشكل معروف: type + status رقمي.
 * بنتأكد من الاتنين مع بعض عشان ما نرجّعش status جاي من error عشوائي
 * (مكتبة تانية ممكن تحط .status بمعنى مختلف تمامًا).
 */
function isBodyParserError(err: unknown): err is { type: string; status: number } {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { type?: unknown; status?: unknown };
  return (
    typeof e.type === "string" &&
    e.type.startsWith("entity.") &&
    typeof e.status === "number" &&
    e.status >= 400 &&
    e.status < 500
  );
}

// 404 لأي route مش موجود
export function notFoundHandler(req: Request, res: Response) {
  const body: ErrorBody = {
    ok: false,
    error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found` },
  };
  res.status(404).json(body);
}

// الـ middleware المركزي — لازم يتسجل آخر حاجة في app.use
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // 1) أخطاء متوقعة رمناها بنفسنا
  if (err instanceof AppError) {
    const body: ErrorBody = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    return res.status(err.statusCode).json(body);
  }

  // 2) أخطاء الـ validation من Zod — بنرجع تفاصيل مفيدة للمبرمج
  if (err instanceof ZodError) {
    const body: ErrorBody = {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    };
    return res.status(422).json(body);
  }

  // 3) أخطاء express.json (body-parser): جسم أكبر من الحد، أو JSON مشوّه.
  //    دي أخطاء عميل ومعاها status صحيح جاهز، بس الكود كان بيتجاهله ويرجّع
  //    500 — يعني العميل بياخد "في مشكلة في السيرفر" وهو اللي باعت طلب غلط،
  //    والأسوأ إنها بتتسجل عندك كأعطال سيرفر وبتغرّق أي error monitoring.
  //    بنتحقق من type عشان ما نثقش في أي .status على أي error عشوائي.
  if (isBodyParserError(err)) {
    const tooLarge = err.type === "entity.too.large";
    const body: ErrorBody = {
      ok: false,
      error: {
        code: tooLarge ? "PAYLOAD_TOO_LARGE" : "MALFORMED_JSON",
        message: tooLarge ? "Request body is too large" : "Request body is not valid JSON",
      },
    };
    return res.status(err.status).json(body);
  }

  // 4) أي حاجة غير متوقعة — بنسجلها كاملة في اللوج
  //    وبنرجع للمستخدم رسالة عامة من غير ما نسرّب تفاصيل داخلية
  console.error(`[ERROR] ${req.method} ${req.path}`, err);
  const body: ErrorBody = {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  };
  return res.status(500).json(body);
}

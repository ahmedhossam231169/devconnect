import type { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "../lib/jwt.js";
import { Errors } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

// بنوسّع type بتاع Request عشان req.user يبقى typed في كل مكان
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      // صلاحية الإشراف — بتتقرا من الداتابيز في requireAuth، مش من الـ JWT.
      // مقصودة كده: لو كانت جوه التوكن، سحب الصلاحية مش هيسري غير لما
      // التوكن يخلص أو نزوّد tokenVersion (اللي بيطلّع كل أجهزة اليوزر).
      isAdmin?: boolean;
    }
  }
}

// أي route محتاج تسجيل دخول بيستخدم ده
// [SECURITY BUG-05] بقى async: بعد التحقق من توقيع الـ JWT بنتأكد إن
// tokenVersion اللي جواه لسه مطابق للي في الداتابيز. إعادة تعيين الباسورد
// بتزوّد الرقم، فأي توكن قديم (حتى المسروق) بيترفض هنا فورًا.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(Errors.unauthorized("Missing Authorization header"));
  }

  let payload: TokenPayload;
  try {
    payload = verifyToken(header.slice("Bearer ".length));
  } catch (err) {
    return next(err);
  }

  prisma.user
    // isAdmin بيتضاف للـ select الموجود أصلًا → مفيش استعلام زيادة
    .findUnique({ where: { id: payload.userId }, select: { tokenVersion: true, isAdmin: true } })
    .then((user) => {
      // مستخدم متمسح، أو التوكن من قبل آخر إعادة تعيين باسورد → مرفوض
      // (?? 0 عشان التوكنات القديمة اللي اتصدرت قبل الميزة تفضل شغّالة لحد أول reset)
      if (!user || user.tokenVersion !== (payload.tokenVersion ?? 0)) {
        return next(Errors.unauthorized("Session expired. Please sign in again."));
      }
      req.user = payload;
      req.isAdmin = user.isAdmin;
      next();
    })
    .catch(next);
}

// guard للـ routes الإدارية. لازم ييجي بعد requireAuth (هو اللي بيملا req.isAdmin).
// بيرجع 404 مش 403 عن قصد: 403 بيأكد لأي حد إن /api/admin موجود وإن الحساب ده
// مش أدمن، وده بيدي المهاجم إشارة يدوّر بيها على حساب أدمن. 404 بتخلي المسار
// كله كإنه مش موجود لغير الأدمن.
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(Errors.unauthorized());
  if (!req.isAdmin) return next(Errors.notFound("Route"));
  next();
}

// guard إضافي للـ routes الخاصة بالـ recruiters بس (هنحتاجه في مرحلة الـ Talent Search)
export function requireRole(role: TokenPayload["role"]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw Errors.unauthorized();
    if (req.user.role !== role) {
      throw Errors.forbidden(`This action requires a ${role} account`);
    }
    next();
  };
}

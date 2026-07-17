import jwt from "jsonwebtoken";
import { Errors } from "./errors.js";
import { config } from "./config.js";

// التحقق (موجود + 32 حرف على الأقل) بيحصل في lib/config.ts وقت تشغيل السيرفر
const JWT_SECRET = config.JWT_SECRET;

export interface TokenPayload {
  userId: string;
  role: "DEVELOPER" | "RECRUITER";
  // [SECURITY BUG-05] لازم يطابق User.tokenVersion وقت التحقق — غير كده التوكن مبطّل
  tokenVersion: number;
}

/**
 * عمر الـ access token.
 *
 * كان 7 أيام (أو 30 مع "keep me signed in"). الـ JWT مالوش إلغاء — بيفضل
 * صالح لحد ما يخلص، يعني توكن مسروق كان بيدي دخول كامل لشهر. 15 دقيقة
 * بتخلي شباك الضرر ده 15 دقيقة، والاستمرارية بقت شغلة الـ refresh token
 * (lib/refreshTokens.ts) اللي متخزن في الداتابيز وبيتلغي فعليًا.
 *
 * ليه 15 مش أقل: كل تجديد = طلب شبكة + كتابة في الداتابيز. 15 دقيقة توازن
 * معقول بين ده وبين شباك التوكن المسروق.
 */
const ACCESS_TTL = "15m";

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    // expired أو متلاعب فيه — نفس الرد في الحالتين
    throw Errors.unauthorized("Invalid or expired token");
  }
}

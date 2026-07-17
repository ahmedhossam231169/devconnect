// ---------------------------------------------------------------
// [SECURITY BUG-06] حماية الـ brute force على مستوى الحساب
//
// ليه ده موجود بجانب الـ rate limiting بتاع الـ IP:
// authLimiter بيحد 10 محاولات كل 15 دقيقة **لكل IP**. ده بيوقف المهاجم اللي
// شغال من مكان واحد، بس مابيعملش حاجة قدام هجوم موزّع — مهاجم عنده 500 IP
// بياخد من كل واحد 10 محاولات = 5000 محاولة على نفس الحساب، وكل واحدة فيهم
// "تحت الحد" من ناحية الـ IP. الحد ده بيتعد على الحساب نفسه فمش مهم الهجوم
// جاي منين.
//
// الحالة في الداتابيز مش في الذاكرة عن قصد: عشان تعيش بعد أي restart أو
// deploy. عدّاد في الذاكرة بيتصفّر مع كل نشر — وانت بتنشر كتير وقت الإطلاق.
//
// اختيار الأرقام:
// الحد هنا (20) **أعلى** من حد الـ IP (10) عن قصد. المستخدم العادي اللي
// بينسى باسورده وشغال من IP واحد بيوصل لحد الـ IP الأول وبياخد رسالة واضحة
// ("Too many attempts. Try again in 15 minutes"). القفل ده مابيوصلوش عمليًا
// إلا في هجوم موزّع — واللي مستاهلش رسالة واضحة أصلاً.
// ---------------------------------------------------------------
import { prisma } from "./prisma.js";

/** المحاولات الفاشلة بتتعد جوه الشباك ده — بره الشباك العدّاد بيبدأ من الأول */
const WINDOW_MS = 15 * 60 * 1000;
/** فوق كده الحساب بيتقفل. أعلى من حد الـ IP (10) عن قصد — شوف الشرح فوق */
const MAX_FAILED_ATTEMPTS = 20;
/** مدة القفل. محدودة عن قصد: قفل دائم = وسيلة DoS ضد صاحب الحساب */
const LOCK_MS = 15 * 60 * 1000;

export interface ThrottleState {
  id: string;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  lockedUntil: Date | null;
}

/** الحساب متقفل دلوقتي؟ */
export function isLocked(user: Pick<ThrottleState, "lockedUntil">): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
}

/**
 * بيسجّل محاولة دخول فاشلة، وبيقفل الحساب لو عدّى الحد.
 * المحاولات القديمة (بره الشباك) مابتتحسبش — عشان مستخدم بينسى باسورده
 * مرة كل شهر ما يتقفلش عليه الحساب بالتراكم.
 */
export async function recordFailedLogin(user: ThrottleState): Promise<void> {
  const now = Date.now();
  const withinWindow =
    !!user.lastFailedLoginAt && now - user.lastFailedLoginAt.getTime() < WINDOW_MS;
  const attempts = withinWindow ? user.failedLoginAttempts + 1 : 1;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: attempts,
      lastFailedLoginAt: new Date(now),
      // المحاولات وهو متقفل بتمدد القفل — الهجوم المستمر مابياخدش نافذة كل 15 دقيقة
      ...(attempts >= MAX_FAILED_ATTEMPTS ? { lockedUntil: new Date(now + LOCK_MS) } : {}),
    },
  });
}

/**
 * بيصفّر الحالة. بينادى بعد دخول ناجح وبعد إعادة تعيين الباسورد —
 * في الحالتين صاحب الحساب أثبت إنه هو، فمالوش لازمة يفضل متقفل.
 */
export async function clearLoginThrottle(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lastFailedLoginAt: null, lockedUntil: null },
  });
}

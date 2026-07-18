// ---------------------------------------------------------------
// Refresh tokens — الجلسات الحقيقية
//
// المشكلة اللي بيحلها الملف ده:
// الـ access token كان JWT عمره 7 أو 30 يوم متخزن في localStorage. الـ JWT
// مالوش زرار إلغاء — بمجرد ما يتوقّع يفضل صالح لحد ما يخلص. يعني توكن
// مسروق = دخول كامل على الحساب لشهر، ومفيش تسجيل خروج حقيقي (المسح من
// localStorage بيمسح النسخة اللي عند المستخدم بس، مش اللي عند اللص)،
// ومفيش طريقة تطلّع جهاز واحد بعينه. الطريقة الوحيدة كانت tokenVersion
// اللي بتطلّع كل الأجهزة مرة واحدة.
//
// دلوقتي: access token عمره 15 دقيقة (شباك الضرر بقى 15 دقيقة بدل 30 يوم)
// + refresh token متخزن في الداتابيز، فبقى قابل للإلغاء فعليًا.
//
// الدوران وكشف إعادة الاستخدام:
// كل استخدام للـ refresh token بيحرقه وينشئ واحد جديد. لو توكن اتحرق خلاص
// جه اتقدّم تاني، يبقى في نسختين شغالين — يعني اتسرق. مش بنعرف مين
// الأصلي ومين اللص، فبنقفل العيلة كلها ونخلي الاتنين يسجّلوا دخول من أول
// وجديد. ده الحاجز اللي بيخلي سرقة التوكن مؤقتة بدل ما تبقى دائمة.
// ---------------------------------------------------------------
import crypto from "node:crypto";
import type { Request } from "express";
import { prisma } from "./prisma.js";

/** عمر الـ refresh token. بيحدد أقصى مدة غياب قبل ما المستخدم يسجّل دخول تاني. */
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 يوم

/**
 * شباك سماح للدوران المتزامن.
 *
 * تابين مفتوحين بيجدّدوا في نفس اللحظة بيبعتوا نفس الكوكي. واحد بيكسب
 * والتاني بيوصل بتوكن اتحرق للتو — وده شكله زي إعادة الاستخدام بالظبط،
 * فكشف السرقة كان هيقفل عيلة سليمة ويطلّع المستخدم بره. نفس الشيء بيحصل
 * مع شبكة بتقطع والطلب بيتعاد.
 *
 * جوه الشباك ده بنقول للعميل "أعد المحاولة" من غير ما نبطّل حاجة: الكوكي
 * عنده بقى الجديد أصلاً (التاب التاني حدّثه)، فالمحاولة التانية بتنجح.
 * بره الشباك، إعادة الاستخدام بتفضل مؤشر سرقة وبتقفل العيلة.
 *
 * التنازل: مهاجم بيعيد استخدام توكن مسروق خلال 15 ثانية من الدوران مش
 * هيتكشف. ده شباك ضيق جدًا مقابل بديل بيطلّع مستخدمين شرعيين بره كل ما
 * يفتحوا تابين — وإزعاج زي ده بيخلي الناس تطلب إلغاء الحماية أصلاً.
 */
const ROTATION_GRACE_MS = 15 * 1000;

/** SHA-256 — التوكن عشوائي 256-bit، فمفيش داعي لـ hash بطيء */
const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

const newRawToken = () => crypto.randomBytes(32).toString("base64url");

/** بنقص عشان يوزر بـ user-agent طويل ما يفشلش الـ insert */
function deviceInfo(req: Request) {
  return {
    userAgent: (req.headers["user-agent"] ?? "").slice(0, 300) || null,
    ip: (req.ip ?? "").slice(0, 64) || null,
  };
}

export interface IssuedRefresh {
  raw: string;
  expiresAt: Date;
}

/** جلسة جديدة (login / register / OAuth) — عيلة جديدة */
export async function issueRefreshToken(userId: string, req: Request): Promise<IssuedRefresh> {
  const raw = newRawToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash(raw),
      familyId: crypto.randomUUID(),
      expiresAt,
      ...deviceInfo(req),
    },
  });
  return { raw, expiresAt };
}

export class RefreshError extends Error {
  constructor(public readonly reason: "invalid" | "expired" | "revoked" | "reused" | "concurrent") {
    super(reason);
  }
}

/**
 * بيحرق التوكن الحالي وبيطلع واحد جديد في نفس العيلة.
 * بيرمي RefreshError لو التوكن مش صالح — والمستدعي بيمسح الكوكي ويطلب دخول جديد.
 */
export async function rotateRefreshToken(
  raw: string,
  req: Request
): Promise<{ userId: string; tokenVersion: number; role: "DEVELOPER" | "RECRUITER" } & IssuedRefresh> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash(raw) },
    select: {
      id: true,
      userId: true,
      familyId: true,
      expiresAt: true,
      rotatedAt: true,
      revokedAt: true,
      user: { select: { tokenVersion: true, role: true } },
    },
  });

  if (!existing) throw new RefreshError("invalid");

  if (existing.rotatedAt) {
    // اتحرق للتو → على الأغلب تاب تاني سبقنا، مش سرقة. أعد المحاولة.
    if (Date.now() - existing.rotatedAt.getTime() < ROTATION_GRACE_MS) {
      throw new RefreshError("concurrent");
    }
    // اتحرق من زمان وجه تاني → في نسختين شغالين. بنقفل العيلة كلها.
    await revokeFamily(existing.familyId);
    throw new RefreshError("reused");
  }
  if (existing.revokedAt) throw new RefreshError("revoked");
  if (existing.expiresAt.getTime() <= Date.now()) throw new RefreshError("expired");

  const raw2 = newRawToken();
  // العمر بيتمدد مع كل دوران: المستخدم النشط ما يتطلبش منه دخول كل 30 يوم،
  // واللي بيسيب التطبيق شهر بيتطلب منه
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  // الفحص فوق (existing.rotatedAt) بيقرا ثم يقرر — بين القراءة والكتابة
  // طلب تاني يقدر يحرق نفس التوكن، فيبقى الاتنين قرأوا null والاتنين نجحوا
  // وطلّعوا توكنين حيّين من عيلة واحدة (TOCTOU). الحل هنا claim ذرّي:
  // updateMany بشرط rotatedAt IS NULL. تحت عزل Postgres الافتراضي، الطلب
  // التاني بيستنى الأول يـ commit وبعدين شرطه بيطابق صفر صفوف — فواحد بس
  // بيكسب الحرق. الخاسر بيتعامل كـ "concurrent" (سباق تابين، مش سرقة).
  //
  // الـ claim والإنشاء في transaction واحدة: لو الإنشاء فشل بعد الحرق،
  // الاتنين بيترجعوا، فالمستخدم مايتطلعش بره من غير توكن جديد.
  const won = await prisma.$transaction(async (tx) => {
    const claim = await tx.refreshToken.updateMany({
      where: { id: existing.id, rotatedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claim.count === 0) return false; // طلب تاني سبقنا للحرق
    await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hash(raw2),
        familyId: existing.familyId, // نفس الجهاز
        expiresAt,
        ...deviceInfo(req),
      },
    });
    return true;
  });

  if (!won) throw new RefreshError("concurrent");

  return {
    userId: existing.userId,
    tokenVersion: existing.user.tokenVersion,
    role: existing.user.role,
    raw: raw2,
    expiresAt,
  };
}

/** العيلة اللي التوكن ده بتاعها — عشان نعلّم "الجهاز ده" في قايمة الجلسات */
export async function familyIdForRawToken(raw: string): Promise<string | null> {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash(raw) },
    select: { familyId: true },
  });
  return row?.familyId ?? null;
}

/** تسجيل خروج جهاز واحد */
export async function revokeByRawToken(raw: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** إبطال عيلة كاملة (جهاز واحد بكل دوراته) */
export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** تسجيل خروج من كل الأجهزة — بيتنادى كمان مع إعادة تعيين الباسورد */
export async function revokeAllForUser(userId: string): Promise<number> {
  const { count } = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/**
 * الجلسات النشطة لليوزر — صف واحد لكل عيلة (أحدث دوران فيها).
 * الصفوف المحروقة جوه العيلة تفاصيل داخلية، المستخدم يهمه الأجهزة بس.
 */
export async function listSessions(userId: string) {
  const rows = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { familyId: true, createdAt: true, userAgent: true, ip: true, expiresAt: true },
  });
  return rows;
}

/**
 * تنضيف الصفوف الميتة. بيتنادى وقت تشغيل السيرفر — من غيره الجدول بيكبر
 * للأبد (كل تجديد بيسيب صف محروق وراه).
 */
export async function pruneExpiredRefreshTokens(): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        // المحروق مالوش لازمة بعد فترة السماح — بنسيبه شوية عشان كشف
        // إعادة الاستخدام يفضل شغال لو نسخة مسروقة اتقدمت متأخر
        { rotatedAt: { lt: new Date(Date.now() - REFRESH_TTL_MS) } },
      ],
    },
  });
  return count;
}

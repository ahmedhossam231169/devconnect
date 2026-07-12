import { prisma } from "./prisma.js";
import { Errors } from "./errors.js";

// ---------------------------------------------------------------
// [SECURITY] الحظر كان بيمسح العلاقات القايمة بس مش بيمنع تفاعلات جديدة —
// حد محظور كان يقدر لسه يبعت طلب صداقة/يتابع/يبدأ محادثة/يلايك ويكومنت.
// الدالة دي بتتنادى قبل أي تفاعل جديد بين مستخدمين (في أي اتجاه للحظر)
// ---------------------------------------------------------------
export async function assertNotBlocked(userA: string, userB: string) {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
  });
  if (block) throw Errors.forbidden("You can't interact with this user");
}

// ---------------------------------------------------------------
// [SECURITY BUG-04] الحظر كان بيمنع التفاعل بس مش القراءة — المحظور كان
// لسه يقدر يشوف بروفايل وبوستات اللي حظره ويلاقيه في البحث. الدالة دي
// بترجّع true لو في حظر في أي اتجاه، فالـ read routes تعرض "مش موجود"
// (404) بدل ما تسرّب المحتوى — إخفاء متبادل بين الطرفين.
// ---------------------------------------------------------------
export async function isBlockedBetween(userA: string, userB: string): Promise<boolean> {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
    select: { blockerId: true },
  });
  return !!block;
}

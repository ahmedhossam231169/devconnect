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

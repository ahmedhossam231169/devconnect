import { prisma } from "./prisma.js";

// ---------------------------------------------------------------
// حساب السمعة (reputation) — مؤشر نشاط المستخدم على المنصة
// بيظهر في البروفايل، ومفيد للـ HR كإشارة على مدى التفاعل
//
// المعادلة (أوزان بسيطة وقابلة للتعديل):
//   كل لايك على بوستاتك      = 5 نقاط
//   كل كومنت على بوستاتك     = 10 نقاط
//   كل بوست نشرته            = 2 نقطة
//   كل صديق                  = 3 نقاط
// ---------------------------------------------------------------

const WEIGHTS = {
  likeReceived: 5,
  commentReceived: 10,
  post: 2,
  friend: 3,
};

export async function calculateReputation(userId: string): Promise<number> {
  // بوستات المستخدم (عشان نعد اللايكات والكومنتات اللي عليها)
  const posts = await prisma.post.findMany({
    where: { authorId: userId },
    select: { _count: { select: { likes: true, comments: true } } },
  });

  const postCount = posts.length;
  const likesReceived = posts.reduce((sum: number, p: any) => sum + p._count.likes, 0);
  const commentsReceived = posts.reduce((sum: number, p: any) => sum + p._count.comments, 0);

  // عدد الأصدقاء (علاقات مقبولة في أي اتجاه)
  const friendCount = await prisma.friendship.count({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
  });

  return (
    likesReceived * WEIGHTS.likeReceived +
    commentsReceived * WEIGHTS.commentReceived +
    postCount * WEIGHTS.post +
    friendCount * WEIGHTS.friend
  );
}

import { prisma } from "./prisma.js";
import { emitToUser } from "../socket.js";

type NotificationType =
  | "POST_LIKE"
  | "POST_COMMENT"
  | "COMMUNITY_JOIN"
  | "FRIEND_REQUEST"
  | "FRIEND_ACCEPT"
  | "NEW_FOLLOWER";

interface NotifyInput {
  userId: string; // المستلم
  actorId?: string; // اللي عمل الحدث
  type: NotificationType;
  message: string;
  link?: string;
}

// ---------------------------------------------------------------
// نقطة واحدة لإنشاء أي إشعار في المشروع كله:
// 1) بيتسجل في الداتابيز (عشان يظهر لو المستخدم مش متصل دلوقتي)
// 2) بيتبعت real-time لو المستخدم متصل (نفس قناة الشات بتاعة socket.ts)
// ---------------------------------------------------------------
export async function notify(input: NotifyInput) {
  // ما بنبعتش إشعار لنفسك (مثلاً لو حد عمل لايك على بوسته هو نفسه — مش وارد أصلًا بس أمان زيادة)
  if (input.actorId === input.userId) return null;

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      actorId: input.actorId ?? null,
      type: input.type,
      message: input.message,
      link: input.link ?? null,
    },
    select: {
      id: true,
      type: true,
      message: true,
      link: true,
      read: true,
      createdAt: true,
    },
  });

  emitToUser(input.userId, "notification:new", notification);
  return notification;
}

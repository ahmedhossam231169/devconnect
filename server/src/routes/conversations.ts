import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const conversationsRouter = Router();

const startConversationSchema = z.object({
  username: z.string().min(1, "Username is required"),
});

const participantSelect = {
  user: {
    select: {
      id: true,
      username: true,
      profile: { select: { displayName: true, avatarUrl: true, headline: true } },
    },
  },
} as const;

// الشكل الراجع من الـ select — types صريحة عشان الاتساق
interface ParticipantShape {
  user: {
    id: string;
    username: string;
    profile: { displayName: string; avatarUrl: string | null; headline: string | null } | null;
  };
}
interface ConversationRow {
  id: string;
  isGroup: boolean;
  name: string | null;
  updatedAt: Date;
  participants: ParticipantShape[];
  messages: { body: string; senderId: string; codeContent: string | null; createdAt: Date }[];
}

// ---------------------------------------------------------------
// GET /api/conversations — كل محادثات المستخدم مرتبة بآخر نشاط
// ---------------------------------------------------------------
conversationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        isGroup: true,
        name: true,
        updatedAt: true,
        participants: { select: participantSelect },
        // آخر رسالة بس — للـ preview في القايمة الشمال
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, senderId: true, codeContent: true, createdAt: true },
        },
      },
    });

    // بنرجّع "الطرف التاني" جاهز بدل ما الـ client يفلتر بنفسه
    const shaped = (conversations as ConversationRow[]).map((c) => {
      const other = c.participants.find((p: ParticipantShape) => p.user.id !== userId)?.user ?? null;
      const last = c.messages[0] ?? null;
      return {
        id: c.id,
        isGroup: c.isGroup,
        // اسم العرض: للجروب اسمه، للفردي اسم الطرف التاني
        title: c.isGroup ? c.name : (other?.profile?.displayName ?? "Unknown"),
        memberCount: c.participants.length,
        updatedAt: c.updatedAt,
        other,
        lastMessage: last
          ? {
              preview: last.codeContent ? "📎 Code snippet" : last.body,
              mine: last.senderId === userId,
              createdAt: last.createdAt,
            }
          : null,
      };
    });

    res.json({ ok: true, conversations: shaped });
  })
);

// ---------------------------------------------------------------
// POST /api/conversations — ابدأ (أو رجّع) محادثة مع مستخدم بالـ username
// find-or-create: لو في محادثة بينكم بالفعل بنرجعها بدل ما نكرر
// ---------------------------------------------------------------
conversationsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { username } = startConversationSchema.parse(req.body);
    const me = req.user!.userId;

    const other = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!other) throw Errors.notFound("User");
    if (other.id === me) throw Errors.badRequest("You can't message yourself");

    const existing = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: me } } },
          { participants: { some: { userId: other.id } } },
        ],
      },
      select: { id: true },
    });

    if (existing) {
      return res.json({ ok: true, conversationId: existing.id, created: false });
    }

    const conversation = await prisma.conversation.create({
      data: {
        participants: { create: [{ userId: me }, { userId: other.id }] },
      },
      select: { id: true },
    });

    res.status(201).json({ ok: true, conversationId: conversation.id, created: true });
  })
);

// ---------------------------------------------------------------
// GET /api/conversations/:id/messages — آخر 50 رسالة
// ---------------------------------------------------------------
conversationsRouter.get(
  "/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id!;
    const userId = req.user!.userId;

    // أمان: لازم تكون طرف في المحادثة عشان تقرأها
    const membership = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!membership) throw Errors.forbidden("You're not part of this conversation");

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        senderId: true,
        body: true,
        codeLanguage: true,
        codeContent: true,
        createdAt: true,
        sender: {
          select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } },
        },
      },
    });

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { participants: { select: participantSelect } },
    });
    const other =
      (conversation?.participants as ParticipantShape[] | undefined)?.find((p) => p.user.id !== userId)?.user ?? null;

    res.json({ ok: true, messages, other });
  })
);

// ---------------------------------------------------------------
// POST /api/conversations/group — إنشاء جروب (أصدقاء بس)
// ---------------------------------------------------------------
import { z as zGroup } from "zod";

const createGroupSchema = zGroup.object({
  name: zGroup.string().min(2, "Group name is too short").max(60),
  usernames: zGroup.array(zGroup.string()).min(1, "Add at least one friend").max(20),
});

conversationsRouter.post(
  "/group",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createGroupSchema.parse(req.body);
    const me = req.user!.userId;

    // نجيب الـ IDs بتاعت الأعضاء المطلوبين
    const members = await prisma.user.findMany({
      where: { username: { in: input.usernames } },
      select: { id: true, username: true },
    });
    if (members.length === 0) throw Errors.badRequest("No valid users to add");

    // تحقق: كل عضو لازم يكون صديق للمنشئ (زي ما اتفقنا)
    for (const member of members) {
      const friendship = await prisma.friendship.findFirst({
        where: {
          status: "ACCEPTED",
          OR: [
            { requesterId: me, addresseeId: member.id },
            { requesterId: member.id, addresseeId: me },
          ],
        },
      });
      if (!friendship) {
        throw Errors.forbidden(`@${member.username} is not your friend — only friends can be added`);
      }
    }

    // المنشئ + الأعضاء (من غير تكرار لو المنشئ ضاف نفسه بالغلط)
    const memberIds = [...new Set([me, ...members.map((m: { id: string }) => m.id)])];

    const group = await prisma.conversation.create({
      data: {
        isGroup: true,
        name: input.name,
        participants: { create: memberIds.map((userId: string) => ({ userId })) },
      },
      select: { id: true, name: true, isGroup: true },
    });

    res.status(201).json({ ok: true, conversationId: group.id, group });
  })
);

// ---------------------------------------------------------------
// GET /api/conversations/:id/info — أعضاء الجروب + بياناته
// PATCH /api/conversations/:id — تعديل اسم/صورة الجروب (الأعضاء بس)
// ---------------------------------------------------------------
conversationsRouter.get(
  "/:id/info",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const convId = req.params.id!;
    const member = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId } },
    });
    if (!member) throw Errors.forbidden("Not a member of this conversation");

    const conv = await prisma.conversation.findUnique({
      where: { id: convId },
      select: {
        id: true, isGroup: true, name: true, avatarUrl: true, createdAt: true,
        participants: {
          select: {
            user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true, headline: true } } } },
          },
        },
      },
    });
    if (!conv) throw Errors.notFound("Conversation");
    res.json({ ok: true, conversation: { ...conv, members: (conv as any).participants.map((p: any) => p.user) } });
  })
);

conversationsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const convId = req.params.id!;
    const member = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId } },
    });
    if (!member) throw Errors.forbidden("Not a member of this conversation");

    const input = zGroup.object({
      name: zGroup.string().min(2).max(60).optional(),
      avatarUrl: zGroup.string().url().or(zGroup.literal("")).optional(),
    }).parse(req.body);

    const conv = await prisma.conversation.update({
      where: { id: convId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl || null } : {}),
      },
      select: { id: true, name: true, avatarUrl: true },
    });
    res.json({ ok: true, conversation: conv });
  })
);

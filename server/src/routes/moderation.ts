import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const moderationRouter = Router();

async function findUserByUsername(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!user) throw Errors.notFound("User");
  return user;
}

// ---------------------------------------------------------------
// POST /api/moderation/block/:username — toggle حظر
// الحظر بيشيل أي صداقة/متابعة بين الطرفين تلقائيًا
// ---------------------------------------------------------------
moderationRouter.post(
  "/block/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!.userId;
    const other = await findUserByUsername(req.params.username!);
    if (other.id === me) throw Errors.badRequest("You can't block yourself");

    const existing = await prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: me, blockedId: other.id } },
    });

    if (existing) {
      await prisma.block.delete({
        where: { blockerId_blockedId: { blockerId: me, blockedId: other.id } },
      });
      return res.json({ ok: true, blocked: false });
    }

    await prisma.block.create({ data: { blockerId: me, blockedId: other.id } });

    // نظّف أي علاقات قايمة بينهم
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: me, addresseeId: other.id },
          { requesterId: other.id, addresseeId: me },
        ],
      },
    });
    await prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: me, followingId: other.id },
          { followerId: other.id, followingId: me },
        ],
      },
    });

    res.json({ ok: true, blocked: true });
  })
);

// ---------------------------------------------------------------
// GET /api/moderation/blocked — قائمة اللي حظرتهم
// ---------------------------------------------------------------
moderationRouter.get(
  "/blocked",
  requireAuth,
  asyncHandler(async (req, res) => {
    const blocks = await prisma.block.findMany({
      where: { blockerId: req.user!.userId },
      select: {
        blocked: {
          select: {
            username: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    });
    res.json({ ok: true, blocked: blocks.map((b: any) => b.blocked) });
  })
);

// ---------------------------------------------------------------
// POST /api/moderation/report — بلاغ عن بوست أو مستخدم
// ---------------------------------------------------------------
const reportSchema = z
  .object({
    reason: z.string().min(3, "Tell us briefly what's wrong").max(500),
    postId: z.string().optional(),
    username: z.string().optional(),
  })
  .refine((d) => d.postId || d.username, {
    message: "Report must target a post or a user",
  });

moderationRouter.post(
  "/report",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = reportSchema.parse(req.body);
    const me = req.user!.userId;

    let targetUserId: string | undefined;
    if (input.username) {
      const user = await findUserByUsername(input.username);
      targetUserId = user.id;
    }

    await prisma.report.create({
      data: {
        reporterId: me,
        reason: input.reason,
        targetPostId: input.postId ?? null,
        targetUserId: targetUserId ?? null,
      },
    });

    // مافيش رد مفصّل — البلاغ اتسجل للمراجعة اليدوية
    res.status(201).json({ ok: true, message: "Report submitted. Our team will review it." });
  })
);

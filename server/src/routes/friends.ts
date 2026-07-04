import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { notify } from "../lib/notify.js";

export const friendsRouter = Router();

const targetSchema = z.object({ username: z.string().min(1) });

const userCard = {
  select: {
    id: true,
    username: true,
    profile: { select: { displayName: true, avatarUrl: true, headline: true } },
  },
} as const;

// helper: يجيب مستخدم بالـ username أو يرمي 404
async function findUserByUsername(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true },
  });
  if (!user) throw Errors.notFound("User");
  return user;
}

// ---------------------------------------------------------------
// POST /api/friends/request — إرسال طلب صداقة
// ---------------------------------------------------------------
friendsRouter.post(
  "/request",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { username } = targetSchema.parse(req.body);
    const me = req.user!.userId;
    const other = await findUserByUsername(username);

    if (other.id === me) throw Errors.badRequest("You can't friend yourself");

    // في علاقة بالفعل؟ (في أي اتجاه)
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: me, addresseeId: other.id },
          { requesterId: other.id, addresseeId: me },
        ],
      },
    });
    if (existing) {
      if (existing.status === "ACCEPTED") throw Errors.conflict("You're already friends");
      throw Errors.conflict("A friend request is already pending");
    }

    await prisma.friendship.create({
      data: { requesterId: me, addresseeId: other.id, status: "PENDING" },
    });

    const meUser = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    await notify({
      userId: other.id,
      actorId: me,
      type: "FRIEND_REQUEST",
      message: `@${meUser?.username} sent you a friend request`,
      link: `/u/${meUser?.username}`,
    });

    res.status(201).json({ ok: true });
  })
);

// ---------------------------------------------------------------
// POST /api/friends/respond — قبول أو رفض طلب
// ---------------------------------------------------------------
friendsRouter.post(
  "/respond",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { username, accept } = z
      .object({ username: z.string().min(1), accept: z.boolean() })
      .parse(req.body);
    const me = req.user!.userId;
    const other = await findUserByUsername(username);

    // لازم أكون أنا المستقبِل للطلب
    const request = await prisma.friendship.findFirst({
      where: { requesterId: other.id, addresseeId: me, status: "PENDING" },
    });
    if (!request) throw Errors.notFound("Friend request");

    if (accept) {
      await prisma.friendship.update({ where: { id: request.id }, data: { status: "ACCEPTED" } });
      const meUser = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
      await notify({
        userId: other.id,
        actorId: me,
        type: "FRIEND_ACCEPT",
        message: `@${meUser?.username} accepted your friend request`,
        link: `/u/${meUser?.username}`,
      });
    } else {
      await prisma.friendship.delete({ where: { id: request.id } });
    }

    res.json({ ok: true, accepted: accept });
  })
);

// ---------------------------------------------------------------
// DELETE /api/friends/:username — إلغاء صداقة أو سحب طلب
// ---------------------------------------------------------------
friendsRouter.delete(
  "/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!.userId;
    const other = await findUserByUsername(req.params.username!);

    const rel = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: me, addresseeId: other.id },
          { requesterId: other.id, addresseeId: me },
        ],
      },
    });
    if (!rel) throw Errors.notFound("Friendship");

    await prisma.friendship.delete({ where: { id: rel.id } });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------
// GET /api/friends — قائمة أصدقائي
// GET /api/friends/pending — الطلبات الواردة اللي مستنية ردي
// ---------------------------------------------------------------
friendsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!.userId;
    const friendships = await prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: me }, { addresseeId: me }],
      },
      select: {
        requester: userCard,
        addressee: userCard,
        requesterId: true,
      },
    });
    // نرجّع "الطرف التاني" في كل علاقة
    const friends = friendships.map((f: any) =>
      f.requesterId === me ? f.addressee : f.requester
    );
    res.json({ ok: true, friends });
  })
);

friendsRouter.get(
  "/pending",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!.userId;
    const requests = await prisma.friendship.findMany({
      where: { addresseeId: me, status: "PENDING" },
      select: { requester: userCard, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, requests: requests.map((r: any) => r.requester) });
  })
);

// ---------------------------------------------------------------
// GET /api/friends/status/:username — حالة علاقتي بمستخدم معيّن
// (عشان زرار البروفايل يعرف يعرض إيه: Add / Pending / Friends / Respond)
// ---------------------------------------------------------------
friendsRouter.get(
  "/status/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!.userId;
    const other = await findUserByUsername(req.params.username!);

    const [friendship, iFollow] = await Promise.all([
      prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: me, addresseeId: other.id },
            { requesterId: other.id, addresseeId: me },
          ],
        },
      }),
      prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: me, followingId: other.id } },
      }),
    ]);

    let friendState: "none" | "friends" | "request_sent" | "request_received" = "none";
    if (friendship) {
      if (friendship.status === "ACCEPTED") friendState = "friends";
      else if (friendship.requesterId === me) friendState = "request_sent";
      else friendState = "request_received";
    }

    res.json({ ok: true, friendState, following: !!iFollow });
  })
);

// ---------------------------------------------------------------
// POST /api/friends/follow/:username — toggle متابعة
// ---------------------------------------------------------------
friendsRouter.post(
  "/follow/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!.userId;
    const other = await findUserByUsername(req.params.username!);
    if (other.id === me) throw Errors.badRequest("You can't follow yourself");

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: me, followingId: other.id } },
    });

    if (existing) {
      await prisma.follow.delete({
        where: { followerId_followingId: { followerId: me, followingId: other.id } },
      });
      return res.json({ ok: true, following: false });
    }

    await prisma.follow.create({ data: { followerId: me, followingId: other.id } });
    const meUser = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    await notify({
      userId: other.id,
      actorId: me,
      type: "NEW_FOLLOWER",
      message: `@${meUser?.username} started following you`,
      link: `/u/${meUser?.username}`,
    });

    res.json({ ok: true, following: true });
  })
);

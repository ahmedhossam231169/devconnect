import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { createPostSchema, createCommentSchema, feedQuerySchema } from "../schemas/posts.js";
import { notify } from "../lib/notify.js";

export const postsRouter = Router();

// شكل البوست اللي بيرجع للـ client — دايمًا نفس الـ select عشان الاتساق
const postSelect = (viewerId: string) =>
  ({
    id: true,
    type: true,
    title: true,
    body: true,
    codeLanguage: true,
    codeContent: true,
    imageUrl: true,
    createdAt: true,
    author: {
      select: {
        username: true,
        profile: { select: { displayName: true, avatarUrl: true, headline: true } },
      },
    },
    _count: { select: { likes: true, comments: true } },
    // hack لطيف: بنجيب لايك المستخدم الحالي بس — لو المصفوفة فيها عنصر يبقى عامل لايك
    likes: { where: { userId: viewerId }, select: { userId: true, type: true } },
  }) as const;

// بنحول شكل Prisma لشكل أنضف للـ client
function shapePost(p: any) {
  const { likes, _count, ...rest } = p;
  return { ...rest, likeCount: _count.likes, commentCount: _count.comments, likedByMe: likes.length > 0, myReaction: likes[0]?.type ?? null };
}

// ---------------------------------------------------------------
// GET /api/posts — الـ feed (cursor pagination + sort)
// ---------------------------------------------------------------
postsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = feedQuerySchema.parse(req.query);

    const posts = await prisma.post.findMany({
      // الـ feed العام يعرض البوستات العامة بس — بوستات المجتمعات والصفحات ليها صفحاتها
      where: { communityId: null, pageId: null },
      take: q.take + 1, // واحد زيادة عشان نعرف لو في صفحة بعد كده
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy:
        q.sort === "top"
          ? [{ likes: { _count: "desc" } }, { createdAt: "desc" }]
          : [{ createdAt: "desc" }],
      select: postSelect(req.user!.userId),
    });

    const hasMore = posts.length > q.take;
    const page = hasMore ? posts.slice(0, q.take) : posts;

    res.json({
      ok: true,
      posts: page.map(shapePost),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    });
  })
);

// ---------------------------------------------------------------
// POST /api/posts — إنشاء بوست (نص / سؤال / snippet)
// ---------------------------------------------------------------
postsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createPostSchema.parse(req.body);

    const post = await prisma.post.create({
      data: {
        authorId: req.user!.userId,
        type: input.type,
        title: input.title ?? null,
        body: input.body,
        codeLanguage: input.type === "SNIPPET" ? input.codeLanguage : null,
        codeContent: input.type === "SNIPPET" ? input.codeContent : null,
        imageUrl: input.imageUrl ?? null,
      },
      select: postSelect(req.user!.userId),
    });

    res.status(201).json({ ok: true, post: shapePost(post) });
  })
);

// ---------------------------------------------------------------
// POST /api/posts/:id/like — toggle: لايك لو مش عامل، شيله لو عامل
// ---------------------------------------------------------------
postsRouter.post(
  "/:id/like",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = req.params.id!;
    const userId = req.user!.userId;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, title: true, body: true },
    });
    if (!post) throw Errors.notFound("Post");

    const reactionType = (req.body?.type as string) || "LIKE";
    const VALID = ["LIKE", "LOVE", "SUPPORT", "CELEBRATE", "ANGRY"];
    if (!VALID.includes(reactionType)) throw Errors.badRequest("Invalid reaction type");

    const existing = await prisma.like.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing && existing.type === reactionType) {
      // نفس الرياكشن مرتين = شيله
      await prisma.like.delete({ where: { userId_postId: { userId, postId } } });
    } else if (existing) {
      // رياكشن مختلف = بدّله
      await prisma.like.update({ where: { userId_postId: { userId, postId } }, data: { type: reactionType as any } });
    } else {
      await prisma.like.create({ data: { userId, postId, type: reactionType as any } });

      // إشعار لصاحب البوست — بس لما حد "يعمل" لايك، مش لما يشيله
      const liker = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      await notify({
        userId: post.authorId,
        actorId: userId,
        type: "POST_LIKE",
        message: `@${liker?.username} liked your post "${(post.title ?? post.body).slice(0, 40)}"`,
        link: "/feed",
      });
    }

    const likeCount = await prisma.like.count({ where: { postId } });
    const mine = await prisma.like.findUnique({ where: { userId_postId: { userId, postId } } });
    res.json({ ok: true, liked: !!mine, myReaction: mine?.type ?? null, likeCount });
  })
);

// ---------------------------------------------------------------
// GET /api/posts/:id/comments
// ---------------------------------------------------------------
postsRouter.get(
  "/:id/comments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const comments = await prisma.comment.findMany({
      where: { postId: req.params.id! },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: {
          select: {
            username: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    });
    res.json({ ok: true, comments });
  })
);

// ---------------------------------------------------------------
// POST /api/posts/:id/comments
// ---------------------------------------------------------------
postsRouter.post(
  "/:id/comments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createCommentSchema.parse(req.body);
    const postId = req.params.id!;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, title: true, body: true },
    });
    if (!post) throw Errors.notFound("Post");

    const comment = await prisma.comment.create({
      data: { postId, authorId: req.user!.userId, body: input.body },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: {
          select: {
            username: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    });

    await notify({
      userId: post.authorId,
      actorId: req.user!.userId,
      type: "POST_COMMENT",
      message: `@${comment.author.username} commented on your post "${(post.title ?? post.body).slice(0, 40)}"`,
      link: "/feed",
    });

    res.status(201).json({ ok: true, comment });
  })
);

// ---------------------------------------------------------------
// GET /api/posts/user/:username — بوستات مستخدم معيّن (لصفحة البروفايل العامة)
// ---------------------------------------------------------------
postsRouter.get(
  "/user/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username! },
      select: { id: true },
    });
    if (!user) throw Errors.notFound("User");

    const posts = await prisma.post.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: postSelect(req.user!.userId),
    });

    res.json({ ok: true, posts: posts.map(shapePost) });
  })
);

// ---------------------------------------------------------------
// PATCH /api/posts/:id — تعديل بوست (صاحبه بس)
// ---------------------------------------------------------------
postsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = req.params.id!;
    const existing = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true, type: true },
    });
    if (!existing) throw Errors.notFound("Post");
    if (existing.authorId !== req.user!.userId) {
      throw Errors.forbidden("You can only edit your own posts");
    }

    // بنستخدم نفس الـ schema بتاع الإنشاء عشان نفس قواعد الـ validation
    const input = createPostSchema.parse({ ...req.body, type: existing.type });

    const post = await prisma.post.update({
      where: { id: postId },
      data: {
        title: input.title ?? null,
        body: input.body,
        codeLanguage: input.type === "SNIPPET" ? input.codeLanguage : null,
        codeContent: input.type === "SNIPPET" ? input.codeContent : null,
        imageUrl: input.imageUrl ?? null,
      },
      select: postSelect(req.user!.userId),
    });

    res.json({ ok: true, post: shapePost(post) });
  })
);

// ---------------------------------------------------------------
// DELETE /api/posts/:id — حذف بوست (صاحبه بس)
// الـ likes والـ comments بيتحذفوا تلقائيًا (onDelete: Cascade في الـ schema)
// ---------------------------------------------------------------
postsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = req.params.id!;
    const existing = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });
    if (!existing) throw Errors.notFound("Post");
    if (existing.authorId !== req.user!.userId) {
      throw Errors.forbidden("You can only delete your own posts");
    }

    await prisma.post.delete({ where: { id: postId } });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------
// GET /api/posts/:id/reactions — مين تفاعل مع البوست (رياكشنات)
// ---------------------------------------------------------------
postsRouter.get(
  "/:id/reactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = req.params.id!;
    const reactions = await prisma.like.findMany({
      where: { postId },
      select: {
        type: true,
        user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
      },
    });
    res.json({
      ok: true,
      reactions: reactions.map((r: any) => ({
        type: r.type,
        username: r.user.username,
        displayName: r.user.profile?.displayName ?? r.user.username,
        avatarUrl: r.user.profile?.avatarUrl ?? null,
      })),
    });
  })
);

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { createPostSchema, createCommentSchema, createRepostSchema, feedQuerySchema } from "../schemas/posts.js";
import { notify } from "../lib/notify.js";
import { assertNotBlocked, isBlockedBetween } from "../lib/blocks.js";

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
    pinned: true,
    // مصدر البوست (لو جاي من مجتمع أو صفحة) — الفيد بيعرضه كبادج
    community: { select: { name: true, slug: true } },
    page: { select: { name: true, slug: true } },
    _count: { select: { likes: true, comments: true, reposts: true } },
    // hack لطيف: بنجيب لايك/repost المستخدم الحالي بس — لو المصفوفة فيها عنصر يبقى عامل الفعل ده
    likes: { where: { userId: viewerId }, select: { userId: true, type: true } },
    reposts: { where: { userId: viewerId }, select: { comment: true } },
  }) as const;

// بنحول شكل Prisma لشكل أنضف للـ client
function shapePost(p: any) {
  const { likes, reposts, _count, ...rest } = p;
  return {
    ...rest,
    likeCount: _count.likes,
    commentCount: _count.comments,
    likedByMe: likes.length > 0,
    myReaction: likes[0]?.type ?? null,
    repostCount: _count.reposts,
    repostedByMe: reposts.length > 0,
    myRepostComment: reposts[0]?.comment ?? null,
  };
}

// المستخدم اللي عمل الـ repost — نفس شكل author بتاع البوست
const reposterSelect = {
  username: true,
  profile: { select: { displayName: true, avatarUrl: true, headline: true } },
} as const;

// [SECURITY] بوستات الكوميونتيهات الخاصة للأعضاء بس — الفلتر ده بيتطبق
// في أي مكان بيرجّع بوست ممكن يكون من كوميونتي خاص (permalink، بروفايل، فيد)
const communityVisibility = (viewerId: string) => ({
  OR: [
    { communityId: null },
    { community: { isPrivate: false } },
    { community: { members: { some: { userId: viewerId } } } },
  ],
});

// [SECURITY BUG-02] الموارد الفرعية للبوست (كومنتات/رياكشنز/ريبوستات/لايك/كومنت/ريبوست)
// كانت بتتجاهل فلتر الرؤية اللي الـ permalink بيطبّقه، فحد مش عضو في كوميونتي خاص
// كان يقدر يقرا ويتفاعل مع بوستاته بمجرد معرفة الـ id. الدالة دي بترمي 404 لو
// البوست مش موجود أو مش مرئي للـ viewer — نفس سلوك GET /:id بالظبط.
async function assertPostVisible(postId: string, viewerId: string) {
  const visible = await prisma.post.findFirst({
    where: { id: postId, ...communityVisibility(viewerId) },
    select: { id: true },
  });
  if (!visible) throw Errors.notFound("Post");
}

// ---------------------------------------------------------------
// GET /api/posts — الـ feed (بوستات + reposts متدمجين، مرتبين بالتاريخ أو باللايكات)
// بنجيب أحدث دفعة من الجدولين، بندمجهم، وبنرتبهم في الميموري — مش keyset pagination
// حقيقي عبر جدولين، ده تبسيط مقصود يكفي حجم التطبيق ده
// ---------------------------------------------------------------
postsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = feedQuerySchema.parse(req.query);
    const viewerId = req.user!.userId;
    const FETCH_CAP = 300;

    // اللي بيظهر في الفيد: البوستات العامة + بوستات المجتمعات اللي أنا عضو فيها
    // + بوستات الصفحات اللي أنا متابعها
    const visibleToViewer = {
      OR: [
        { communityId: null, pageId: null },
        { community: { members: { some: { userId: viewerId } } } },
        { page: { followers: { some: { userId: viewerId } } } },
      ],
    };

    const [posts, reposts] = await Promise.all([
      prisma.post.findMany({
        where: visibleToViewer,
        take: FETCH_CAP,
        orderBy: { createdAt: "desc" },
        select: postSelect(viewerId),
      }),
      prisma.repost.findMany({
        where: { post: visibleToViewer },
        take: FETCH_CAP,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          comment: true,
          createdAt: true,
          user: { select: reposterSelect },
          post: { select: postSelect(viewerId) },
        },
      }),
    ]);

    type FeedItem =
      | { kind: "post"; post: any; sortKey: [number, number] }
      | { kind: "repost"; id: string; comment: string | null; createdAt: Date; reposter: any; post: any; sortKey: [number, number] };

    const items: FeedItem[] = [
      ...posts.map((p): FeedItem => {
        const shaped = shapePost(p);
        return { kind: "post", post: shaped, sortKey: [shaped.likeCount, +p.createdAt] };
      }),
      ...reposts.map((r): FeedItem => {
        const shaped = shapePost(r.post);
        return {
          kind: "repost",
          id: r.id,
          comment: r.comment,
          createdAt: r.createdAt,
          reposter: r.user,
          post: shaped,
          sortKey: [shaped.likeCount, +r.createdAt],
        };
      }),
    ];

    items.sort((a, b) =>
      q.sort === "top" ? b.sortKey[0] - a.sortKey[0] || b.sortKey[1] - a.sortKey[1] : b.sortKey[1] - a.sortKey[1]
    );

    const offset = q.cursor ? parseInt(q.cursor, 10) || 0 : 0;
    const page = items.slice(offset, offset + q.take).map(({ sortKey, ...rest }) => rest);
    const nextOffset = offset + q.take;

    res.json({
      ok: true,
      items: page,
      nextCursor: nextOffset < items.length ? String(nextOffset) : null,
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
// GET /api/posts/:id — بوست واحد (permalink — رابط الـ Share)
// ---------------------------------------------------------------
postsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    // [SECURITY] findFirst + فلتر الرؤية: بوست الكوميونتي الخاص مايتشافش بالرابط المباشر
    const post = await prisma.post.findFirst({
      where: { id: req.params.id!, ...communityVisibility(req.user!.userId) },
      select: postSelect(req.user!.userId),
    });
    if (!post) throw Errors.notFound("Post");
    res.json({ ok: true, post: shapePost(post) });
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

    // [SECURITY BUG-02] findFirst + فلتر الرؤية: بوست الكوميونتي الخاص
    // مايتفاعلش معاه غير أعضاؤه — نفس حماية الـ permalink
    const post = await prisma.post.findFirst({
      where: { id: postId, ...communityVisibility(userId) },
      select: { id: true, authorId: true, title: true, body: true },
    });
    if (!post) throw Errors.notFound("Post");
    await assertNotBlocked(userId, post.authorId);

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
// POST /api/posts/:id/repost — toggle: عمل repost لو مش عامل، شيله لو عامل
// (بتعليق اقتباس اختياري — Quote Repost)
// ---------------------------------------------------------------
postsRouter.post(
  "/:id/repost",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = req.params.id!;
    const userId = req.user!.userId;
    const input = createRepostSchema.parse(req.body ?? {});

    // [SECURITY BUG-02] findFirst + فلتر الرؤية: بوست الكوميونتي الخاص
    // مايتفاعلش معاه غير أعضاؤه — نفس حماية الـ permalink
    const post = await prisma.post.findFirst({
      where: { id: postId, ...communityVisibility(userId) },
      select: { id: true, authorId: true, title: true, body: true },
    });
    if (!post) throw Errors.notFound("Post");
    await assertNotBlocked(userId, post.authorId);

    const existing = await prisma.repost.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      // موجود بالفعل = شيله (سواء كان معاه اقتباس أو لأ)
      await prisma.repost.delete({ where: { userId_postId: { userId, postId } } });
    } else {
      await prisma.repost.create({ data: { userId, postId, comment: input.comment ?? null } });

      const reposter = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      await notify({
        userId: post.authorId,
        actorId: userId,
        type: "POST_REPOST",
        message: `@${reposter?.username} reposted your post "${(post.title ?? post.body).slice(0, 40)}"`,
        link: "/feed",
      });
    }

    const repostCount = await prisma.repost.count({ where: { postId } });
    const mine = await prisma.repost.findUnique({ where: { userId_postId: { userId, postId } } });
    res.json({ ok: true, reposted: !!mine, myRepostComment: mine?.comment ?? null, repostCount });
  })
);

// ---------------------------------------------------------------
// GET /api/posts/:id/reposts — مين عمل repost للبوست
// ---------------------------------------------------------------
postsRouter.get(
  "/:id/reposts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = req.params.id!;
    await assertPostVisible(postId, req.user!.userId); // [SECURITY BUG-02]
    const reposts = await prisma.repost.findMany({
      where: { postId },
      orderBy: { createdAt: "desc" },
      select: {
        comment: true,
        user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
      },
    });
    res.json({
      ok: true,
      reposts: reposts.map((r: any) => ({
        comment: r.comment,
        username: r.user.username,
        displayName: r.user.profile?.displayName ?? r.user.username,
        avatarUrl: r.user.profile?.avatarUrl ?? null,
      })),
    });
  })
);

// ---------------------------------------------------------------
// GET /api/posts/:id/comments
// ---------------------------------------------------------------
postsRouter.get(
  "/:id/comments",
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertPostVisible(req.params.id!, req.user!.userId); // [SECURITY BUG-02]
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

    // [SECURITY BUG-02] findFirst + فلتر الرؤية: مايتكومنتش على بوست كوميونتي خاص
    // إلا لأعضائه — نفس حماية الـ permalink
    const post = await prisma.post.findFirst({
      where: { id: postId, ...communityVisibility(req.user!.userId) },
      select: { id: true, authorId: true, title: true, body: true },
    });
    if (!post) throw Errors.notFound("Post");
    await assertNotBlocked(req.user!.userId, post.authorId);

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
// GET /api/posts/user/:username — بوستات مستخدم معيّن + الـ reposts بتاعته
// (لصفحة البروفايل العامة) — نفس شكل FeedItem بتاع الفيد الرئيسي
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

    const viewerId = req.user!.userId;
    // [SECURITY BUG-04] المحظور مايشوفش بوستات اللي حظره
    if (await isBlockedBetween(viewerId, user.id)) throw Errors.notFound("User");
    const [posts, reposts] = await Promise.all([
      prisma.post.findMany({
        // فلتر الرؤية: بوستات الكوميونتيهات الخاصة ماتظهرش في البروفايل لغير أعضائها
        where: { authorId: user.id, ...communityVisibility(viewerId) },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: postSelect(viewerId),
      }),
      // الـ reposts اللي عملها صاحب البروفايل — البوست الأصلي بيتعرض باسم كاتبه
      prisma.repost.findMany({
        where: { userId: user.id, post: communityVisibility(viewerId) },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          comment: true,
          createdAt: true,
          user: { select: reposterSelect },
          post: { select: postSelect(viewerId) },
        },
      }),
    ]);

    // دمج وترتيب بالتاريخ: البوست بتاريخ نشره، والـ repost بتاريخ عمله
    const items = [
      ...posts.map((p) => ({ kind: "post" as const, post: shapePost(p), sortAt: +p.createdAt })),
      ...reposts.map((r) => ({
        kind: "repost" as const,
        id: r.id,
        comment: r.comment,
        createdAt: r.createdAt,
        reposter: r.user,
        post: shapePost(r.post),
        sortAt: +r.createdAt,
      })),
    ]
      .sort((a, b) => b.sortAt - a.sortAt)
      .map(({ sortAt, ...rest }) => rest);

    res.json({ ok: true, items });
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
// DELETE /api/posts/:id — حذف بوست
// صاحبه، أو أدمن المجتمع/الصفحة اللي البوست جواها (moderation)
// الـ likes والـ comments بيتحذفوا تلقائيًا (onDelete: Cascade في الـ schema)
// ---------------------------------------------------------------
postsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = req.params.id!;
    const userId = req.user!.userId;
    const existing = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true, communityId: true, pageId: true },
    });
    if (!existing) throw Errors.notFound("Post");

    let allowed = existing.authorId === userId;
    if (!allowed && existing.communityId) {
      const membership = await prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId: existing.communityId, userId } },
      });
      allowed = membership?.role === "ADMIN";
    }
    if (!allowed && existing.pageId) {
      const admin = await prisma.pageAdmin.findUnique({
        where: { pageId_userId: { pageId: existing.pageId, userId } },
      });
      allowed = !!admin;
    }
    if (!allowed) {
      throw Errors.forbidden("You can only delete your own posts");
    }

    await prisma.post.delete({ where: { id: postId } });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------
// POST /api/posts/:id/pin — تثبيت/فك تثبيت (أدمن الكوميونتي/الصفحة بس)
// البوستات المثبتة بتظهر فوق فيد الكوميونتي/الصفحة
// ---------------------------------------------------------------
postsRouter.post(
  "/:id/pin",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = req.params.id!;
    const userId = req.user!.userId;
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { pinned: true, communityId: true, pageId: true },
    });
    if (!post) throw Errors.notFound("Post");
    if (!post.communityId && !post.pageId) {
      throw Errors.badRequest("Only community or page posts can be pinned");
    }

    let isAdmin = false;
    if (post.communityId) {
      const membership = await prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId: post.communityId, userId } },
      });
      isAdmin = membership?.role === "ADMIN";
    } else if (post.pageId) {
      const admin = await prisma.pageAdmin.findUnique({
        where: { pageId_userId: { pageId: post.pageId, userId } },
      });
      isAdmin = !!admin;
    }
    if (!isAdmin) throw Errors.forbidden("Only admins can pin posts");

    const updated = await prisma.post.update({
      where: { id: postId },
      data: { pinned: !post.pinned },
      select: { pinned: true },
    });
    res.json({ ok: true, pinned: updated.pinned });
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
    await assertPostVisible(postId, req.user!.userId); // [SECURITY BUG-02]
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

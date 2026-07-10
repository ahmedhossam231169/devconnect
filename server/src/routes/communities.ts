import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { createCommunitySchema } from "../schemas/communities.js";
import { notify } from "../lib/notify.js";
import { slugify, uniqueSlug, communitySlugExists } from "../lib/slug.js";

export const communitiesRouter = Router();

const memberPreviewSelect = {
  select: {
    userId: true,
    role: true,
    user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
  },
} as const;

// ---------------------------------------------------------------
// GET /api/communities — قايمة (فلترة بالـ category اختيارية)
// ---------------------------------------------------------------
communitiesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const userId = req.user!.userId;

    const communities = await prisma.community.findMany({
      where: category ? { category } : {},
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        createdAt: true,
        members: { select: { userId: true } },
      },
    });

    const shaped = communities.map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      category: c.category,
      memberCount: c.members.length,
      joinedByMe: c.members.some((m: any) => m.userId === userId),
    }));

    res.json({ ok: true, communities: shaped });
  })
);

// ---------------------------------------------------------------
// POST /api/communities — إنشاء مجتمع جديد (المنشئ بيبقى ADMIN تلقائيًا)
// ---------------------------------------------------------------
communitiesRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createCommunitySchema.parse(req.body);
    const slug = await uniqueSlug(slugify(input.name), communitySlugExists);

    const community = await prisma.community.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        category: input.category,
        members: { create: [{ userId: req.user!.userId, role: "ADMIN" }] },
      },
      select: { id: true, name: true, slug: true, description: true, category: true },
    });

    res.status(201).json({ ok: true, community });
  })
);

// ---------------------------------------------------------------
// GET /api/communities/:slug — تفاصيل + preview لأول 5 أعضاء
// ---------------------------------------------------------------
communitiesRouter.get(
  "/:slug",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        createdAt: true,
        members: memberPreviewSelect,
      },
    });
    if (!community) throw Errors.notFound("Community");

    const { members, ...rest } = community as any;
    res.json({
      ok: true,
      community: {
        ...rest,
        memberCount: members.length,
        joinedByMe: members.some((m: any) => m.userId === userId),
        memberPreview: members.slice(0, 5).map((m: any) => ({
          username: m.user.username,
          displayName: m.user.profile?.displayName ?? m.user.username,
          avatarUrl: m.user.profile?.avatarUrl ?? null,
          role: m.role,
        })),
      },
    });
  })
);

// ---------------------------------------------------------------
// POST /api/communities/:slug/join — toggle: انضمام لو مش عضو، خروج لو عضو
// ---------------------------------------------------------------
communitiesRouter.post(
  "/:slug/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true, name: true, slug: true },
    });
    if (!community) throw Errors.notFound("Community");

    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });

    if (existing) {
      // آخر admin ما يقدرش يسيب المجتمع من غير ما يسلّم الإدارة لحد تاني (تبسيط: نمنعه لو هو الوحيد)
      if (existing.role === "ADMIN") {
        const adminCount = await prisma.communityMember.count({
          where: { communityId: community.id, role: "ADMIN" },
        });
        if (adminCount <= 1) {
          throw Errors.badRequest("You're the only admin — promote someone else before leaving");
        }
      }
      await prisma.communityMember.delete({
        where: { communityId_userId: { communityId: community.id, userId } },
      });
      const memberCount = await prisma.communityMember.count({ where: { communityId: community.id } });
      return res.json({ ok: true, joined: false, memberCount });
    }

    await prisma.communityMember.create({ data: { communityId: community.id, userId } });
    const memberCount = await prisma.communityMember.count({ where: { communityId: community.id } });

    // نبلّغ الـ admins بس (مش كل الأعضاء) إن عضو جديد انضم
    const admins = await prisma.communityMember.findMany({
      where: { communityId: community.id, role: "ADMIN" },
      select: { userId: true },
    });
    const joiner = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    for (const admin of admins) {
      await notify({
        userId: admin.userId,
        actorId: userId,
        type: "COMMUNITY_JOIN",
        message: `@${joiner?.username} joined ${community.name}`,
        link: `/communities/${community.slug}`,
      });
    }

    res.json({ ok: true, joined: true, memberCount });
  })
);

// ---------------------------------------------------------------
// GET /api/communities/:slug/posts — بوستات المجتمع
// POST /api/communities/:slug/posts — نشر في المجتمع (الأعضاء بس)
// ---------------------------------------------------------------
import { createPostSchema } from "../schemas/posts.js";

const communityPostSelect = (viewerId: string) =>
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
    likes: { where: { userId: viewerId }, select: { userId: true, type: true } },
  }) as const;

function shapeCommunityPost(p: any) {
  const { likes, _count, ...rest } = p;
  return { ...rest, likeCount: _count.likes, commentCount: _count.comments, likedByMe: likes.length > 0, myReaction: likes[0]?.type ?? null };
}

communitiesRouter.get(
  "/:slug/posts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true },
    });
    if (!community) throw Errors.notFound("Community");

    const posts = await prisma.post.findMany({
      where: { communityId: community.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: communityPostSelect(req.user!.userId),
    });

    res.json({ ok: true, posts: posts.map(shapeCommunityPost) });
  })
);

communitiesRouter.post(
  "/:slug/posts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true },
    });
    if (!community) throw Errors.notFound("Community");

    // لازم تكون عضو عشان تنشر
    const membership = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });
    if (!membership) throw Errors.forbidden("Join the community to post in it");

    const input = createPostSchema.parse(req.body);
    const post = await prisma.post.create({
      data: {
        authorId: userId,
        communityId: community.id,
        type: input.type,
        title: input.title ?? null,
        body: input.body,
        codeLanguage: input.type === "SNIPPET" ? input.codeLanguage : null,
        codeContent: input.type === "SNIPPET" ? input.codeContent : null,
        imageUrl: input.imageUrl ?? null,
      },
      select: communityPostSelect(userId),
    });

    res.status(201).json({ ok: true, post: shapeCommunityPost(post) });
  })
);

// ---------------------------------------------------------------
// GET /api/communities/:slug/members — أعضاء المجتمع
// PATCH /api/communities/:slug — تعديل (الـ OWNER بس)
// ---------------------------------------------------------------
communitiesRouter.get(
  "/:slug/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true },
    });
    if (!community) throw Errors.notFound("Community");
    const members = await prisma.communityMember.findMany({
      where: { communityId: community.id },
      select: {
        role: true,
        user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true, headline: true } } } },
      },
    });
    res.json({ ok: true, members: members.map((m: any) => ({ ...m.user, role: m.role })) });
  })
);

communitiesRouter.patch(
  "/:slug",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true },
    });
    if (!community) throw Errors.notFound("Community");

    const membership = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });
    if (!membership || membership.role !== "ADMIN") {
      throw Errors.forbidden("Only the community admin can edit it");
    }

    const input = z.object({
      name: z.string().min(2).max(60).optional(),
      description: z.string().max(500).optional(),
    }).parse(req.body);

    const updated = await prisma.community.update({
      where: { id: community.id },
      data: input,
      select: { id: true, name: true, slug: true, description: true },
    });
    res.json({ ok: true, community: updated });
  })
);

// ---------------------------------------------------------------
// DELETE /api/communities/:slug/members/:username — إزالة عضو (ADMIN بس)
// ---------------------------------------------------------------
communitiesRouter.delete(
  "/:slug/members/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true },
    });
    if (!community) throw Errors.notFound("Community");

    const me = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });
    if (!me || me.role !== "ADMIN") throw Errors.forbidden("Only community admins can remove members");

    const target = await prisma.user.findUnique({ where: { username: req.params.username! }, select: { id: true } });
    if (!target) throw Errors.notFound("User");
    if (target.id === userId) throw Errors.badRequest("You can't remove yourself");

    await prisma.communityMember.delete({
      where: { communityId_userId: { communityId: community.id, userId: target.id } },
    }).catch(() => {});
    res.json({ ok: true });
  })
);

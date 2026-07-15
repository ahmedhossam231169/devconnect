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
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const userId = req.user!.userId;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const communities = await prisma.community.findMany({
      where: {
        ...(category ? { category } : {}),
        // بحث بالاسم أو الوصف — خانة البحث في الـ Hub
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        avatarUrl: true,
        coverUrl: true,
        isPrivate: true,
        createdAt: true,
        members: { where: { userId }, select: { userId: true } },
        _count: {
          select: {
            members: true,
            // نشاط الأسبوع — بادج الـ activity في كارت الديزاين
            posts: { where: { createdAt: { gte: weekAgo } } },
          },
        },
      },
    });

    const shaped = communities.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      category: c.category,
      avatarUrl: c.avatarUrl,
      coverUrl: c.coverUrl,
      isPrivate: c.isPrivate,
      memberCount: c._count.members,
      postsThisWeek: c._count.posts,
      joinedByMe: c.members.length > 0,
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
        avatarUrl: input.avatarUrl || null,
        coverUrl: input.coverUrl || null,
        isPrivate: input.isPrivate ?? false,
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
        avatarUrl: true,
        coverUrl: true,
        adminOnlyPosting: true,
        isPrivate: true,
        createdAt: true,
        members: memberPreviewSelect,
      },
    });
    if (!community) throw Errors.notFound("Community");

    // هل الزائر عنده طلب انضمام معلّق؟ (للكوميونتيهات الخاصة)
    const myRequest = await prisma.communityJoinRequest.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });

    const { members, ...rest } = community as any;
    const myMembership = members.find((m: any) => m.userId === userId);
    // [SECURITY BUG-03] preview الأعضاء بيتخفي عن غير أعضاء الكوميونتي الخاص
    // (العدد بس مسموح — مش بيسرّب هوية حد)
    const showRoster = !rest.isPrivate || !!myMembership;
    res.json({
      ok: true,
      community: {
        ...rest,
        memberCount: members.length,
        joinedByMe: !!myMembership,
        myRole: myMembership?.role ?? null,
        requestedByMe: !!myRequest,
        memberPreview: showRoster
          ? members.slice(0, 5).map((m: any) => ({
              username: m.user.username,
              displayName: m.user.profile?.displayName ?? m.user.username,
              avatarUrl: m.user.profile?.avatarUrl ?? null,
              role: m.role,
            }))
          : [],
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
      select: { id: true, name: true, slug: true, isPrivate: true },
    });
    if (!community) throw Errors.notFound("Community");

    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });

    // كوميونتي خاص + مش عضو → الانضمام بطلب (toggle: لو في طلب معلّق بنلغيه)
    if (community.isPrivate && !existing) {
      const pendingRequest = await prisma.communityJoinRequest.findUnique({
        where: { communityId_userId: { communityId: community.id, userId } },
      });
      if (pendingRequest) {
        await prisma.communityJoinRequest.delete({
          where: { communityId_userId: { communityId: community.id, userId } },
        });
        return res.json({ ok: true, joined: false, requested: false });
      }

      await prisma.communityJoinRequest.create({ data: { communityId: community.id, userId } });

      // نبلّغ الأدمنّات إن في طلب جديد مستني مراجعة
      const admins = await prisma.communityMember.findMany({
        where: { communityId: community.id, role: "ADMIN" },
        select: { userId: true },
      });
      const requester = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      for (const admin of admins) {
        await notify({
          userId: admin.userId,
          actorId: userId,
          type: "COMMUNITY_REQUEST",
          message: `@${requester?.username} requested to join ${community.name}`,
          link: `/communities/${community.slug}`,
        });
      }
      return res.json({ ok: true, joined: false, requested: true });
    }

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
    wantsHelp: true,
    imageUrl: true,
    pinned: true,
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
    const userId = req.user!.userId;
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true, isPrivate: true },
    });
    if (!community) throw Errors.notFound("Community");

    // الكوميونتي الخاص: البوستات للأعضاء بس
    if (community.isPrivate) {
      const membership = await prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId: community.id, userId } },
      });
      if (!membership) {
        return res.json({ ok: true, posts: [], private: true });
      }
    }

    const posts = await prisma.post.findMany({
      where: { communityId: community.id },
      // المثبّت الأول، وبعدين الأحدث
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 30,
      select: communityPostSelect(userId),
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
      select: { id: true, adminOnlyPosting: true },
    });
    if (!community) throw Errors.notFound("Community");

    // لازم تكون عضو عشان تنشر
    const membership = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });
    if (!membership) throw Errors.forbidden("Join the community to post in it");

    // وضع المدونة: الأدمنّات بس اللي بينشروا
    if (community.adminOnlyPosting && membership.role !== "ADMIN") {
      throw Errors.forbidden("Only admins can post in this community");
    }

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
        wantsHelp: input.type === "SNIPPET" ? input.wantsHelp : false,
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
    const userId = req.user!.userId;
    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true, isPrivate: true },
    });
    if (!community) throw Errors.notFound("Community");

    // [SECURITY BUG-03] روستر الكوميونتي الخاص للأعضاء بس (كان مكشوف للكل)
    if (community.isPrivate) {
      const membership = await prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId: community.id, userId } },
      });
      if (!membership) throw Errors.forbidden("Join this community to see its members");
    }

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
      adminOnlyPosting: z.boolean().optional(),
      isPrivate: z.boolean().optional(),
      avatarUrl: z.string().url().refine((v) => /^https?:\/\//i.test(v)).or(z.literal("")).optional(),
      coverUrl: z.string().url().refine((v) => /^https?:\/\//i.test(v)).or(z.literal("")).optional(),
    }).parse(req.body);

    const updated = await prisma.community.update({
      where: { id: community.id },
      data: input,
      select: { id: true, name: true, slug: true, description: true, adminOnlyPosting: true, isPrivate: true },
    });
    res.json({ ok: true, community: updated });
  })
);

// ---------------------------------------------------------------
// DELETE /api/communities/:slug — حذف الكوميونتي نهائيًا (ADMIN بس)
// البوستات والأعضاء والطلبات بيتمسحوا تلقائيًا (onDelete: Cascade)
// ---------------------------------------------------------------
communitiesRouter.delete(
  "/:slug",
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
    if (!me || me.role !== "ADMIN") throw Errors.forbidden("Only community admins can delete it");

    await prisma.community.delete({ where: { id: community.id } });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------
// GET /api/communities/:slug/requests — طلبات الانضمام المعلّقة (ADMIN بس)
// POST /api/communities/:slug/requests/:username — قبول أو رفض
// ---------------------------------------------------------------
communitiesRouter.get(
  "/:slug/requests",
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
    if (!me || me.role !== "ADMIN") throw Errors.forbidden("Only community admins can view requests");

    const requests = await prisma.communityJoinRequest.findMany({
      where: { communityId: community.id },
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
      },
    });
    res.json({
      ok: true,
      requests: requests.map((r: any) => ({
        username: r.user.username,
        displayName: r.user.profile?.displayName ?? r.user.username,
        avatarUrl: r.user.profile?.avatarUrl ?? null,
        createdAt: r.createdAt,
      })),
    });
  })
);

communitiesRouter.post(
  "/:slug/requests/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);

    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true, name: true, slug: true },
    });
    if (!community) throw Errors.notFound("Community");

    const me = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });
    if (!me || me.role !== "ADMIN") throw Errors.forbidden("Only community admins can respond to requests");

    const target = await prisma.user.findUnique({
      where: { username: req.params.username! },
      select: { id: true },
    });
    if (!target) throw Errors.notFound("User");

    const request = await prisma.communityJoinRequest.findUnique({
      where: { communityId_userId: { communityId: community.id, userId: target.id } },
    });
    if (!request) throw Errors.notFound("Join request");

    // الطلب بيتمسح في الحالتين — ولو مقبول بنضيف العضوية
    await prisma.communityJoinRequest.delete({
      where: { communityId_userId: { communityId: community.id, userId: target.id } },
    });

    if (accept) {
      await prisma.communityMember.create({
        data: { communityId: community.id, userId: target.id },
      }).catch(() => {}); // لو بقى عضو في السكة، مش مشكلة
      await notify({
        userId: target.id,
        actorId: userId,
        type: "COMMUNITY_REQUEST",
        message: `Your request to join ${community.name} was accepted 🎉`,
        link: `/communities/${community.slug}`,
      });
    }

    res.json({ ok: true, accepted: accept });
  })
);

// ---------------------------------------------------------------
// PATCH /api/communities/:slug/members/:username/role — ترقية/تنزيل (ADMIN بس)
// ---------------------------------------------------------------
communitiesRouter.patch(
  "/:slug/members/:username/role",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const { role } = z.object({ role: z.enum(["ADMIN", "MEMBER"]) }).parse(req.body);

    const community = await prisma.community.findFirst({
      where: { slug: req.params.slug! },
      select: { id: true },
    });
    if (!community) throw Errors.notFound("Community");

    const me = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
    });
    if (!me || me.role !== "ADMIN") throw Errors.forbidden("Only community admins can change roles");

    const target = await prisma.user.findUnique({
      where: { username: req.params.username! },
      select: { id: true },
    });
    if (!target) throw Errors.notFound("User");

    const targetMembership = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId: target.id } },
    });
    if (!targetMembership) throw Errors.notFound("Member");

    // تنزيل أدمن: لازم يفضل أدمن واحد على الأقل
    if (targetMembership.role === "ADMIN" && role === "MEMBER") {
      const adminCount = await prisma.communityMember.count({
        where: { communityId: community.id, role: "ADMIN" },
      });
      if (adminCount <= 1) throw Errors.badRequest("The community needs at least one admin");
    }

    await prisma.communityMember.update({
      where: { communityId_userId: { communityId: community.id, userId: target.id } },
      data: { role },
    });

    // نبلّغ العضو بالترقية/التنزيل
    const communityInfo = await prisma.community.findUnique({
      where: { id: community.id },
      select: { name: true, slug: true },
    });
    await notify({
      userId: target.id,
      actorId: userId,
      type: "COMMUNITY_ROLE",
      message:
        role === "ADMIN"
          ? `You're now an admin of ${communityInfo?.name} 🛡️`
          : `You're no longer an admin of ${communityInfo?.name}`,
      link: `/communities/${communityInfo?.slug}`,
    });

    res.json({ ok: true, role });
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

    // أدمن ما يتشالش مباشرة — لازم يتنزّل member الأول (يمنع الأدمنّات يشيلوا بعض)
    const targetMembership = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId: target.id } },
    });
    if (targetMembership?.role === "ADMIN") {
      throw Errors.badRequest("Demote this admin to member before removing them");
    }

    await prisma.communityMember.delete({
      where: { communityId_userId: { communityId: community.id, userId: target.id } },
    }).catch(() => {});
    res.json({ ok: true });
  })
);

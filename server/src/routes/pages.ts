import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { createPostSchema } from "../schemas/posts.js";
import { httpUrl } from "../schemas/profile.js";
import { slugify, uniqueSlug, pageSlugExists } from "../lib/slug.js";

export const pagesRouter = Router();

export const PAGE_CATEGORIES = ["Company", "Project", "Open Source", "Community", "Product"] as const;

const createPageSchema = z.object({
  name: z.string().min(2, "Name is too short").max(60),
  bio: z.string().max(500).optional(),
  category: z.enum(PAGE_CATEGORIES),
});

const postSelect = (viewerId: string) =>
  ({
    id: true, type: true, title: true, body: true,
    codeLanguage: true, codeContent: true, createdAt: true,
    author: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true, headline: true } } } },
    _count: { select: { likes: true, comments: true } },
    likes: { where: { userId: viewerId }, select: { userId: true, type: true } },
  }) as const;

function shapePost(p: any) {
  const { likes, _count, ...rest } = p;
  return { ...rest, likeCount: _count.likes, commentCount: _count.comments, likedByMe: likes.length > 0, myReaction: likes[0]?.type ?? null };
}

// ---------------------------------------------------------------
// GET /api/pages — قائمة الصفحات
// ---------------------------------------------------------------
pagesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const pages = await prisma.page.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, slug: true, bio: true, category: true, avatarUrl: true,
        followers: { select: { userId: true } },
      },
    });
    const shaped = pages.map((p: any) => ({
      id: p.id, name: p.name, slug: p.slug, bio: p.bio, category: p.category, avatarUrl: p.avatarUrl,
      followerCount: p.followers.length,
      followedByMe: p.followers.some((f: any) => f.userId === userId),
    }));
    res.json({ ok: true, pages: shaped });
  })
);

// ---------------------------------------------------------------
// POST /api/pages — إنشاء صفحة (المنشئ بيبقى ADMIN)
// ---------------------------------------------------------------
pagesRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createPageSchema.parse(req.body);
    const slug = await uniqueSlug(slugify(input.name), pageSlugExists);

    const page = await prisma.page.create({
      data: {
        name: input.name,
        slug,
        bio: input.bio ?? null,
        category: input.category,
        admins: { create: [{ userId: req.user!.userId, role: "ADMIN" }] },
        followers: { create: [{ userId: req.user!.userId }] }, // المنشئ بيتابع صفحته تلقائيًا
      },
      select: { id: true, name: true, slug: true, category: true },
    });

    res.status(201).json({ ok: true, page });
  })
);

// ---------------------------------------------------------------
// GET /api/pages/:slug — تفاصيل صفحة + بوستاتها
// ---------------------------------------------------------------
pagesRouter.get(
  "/:slug",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const page = await prisma.page.findUnique({
      where: { slug: req.params.slug! },
      select: {
        id: true, name: true, slug: true, bio: true, category: true, avatarUrl: true, createdAt: true,
        admins: { select: { userId: true, role: true } },
        followers: { select: { userId: true } },
      },
    });
    if (!page) throw Errors.notFound("Page");

    const posts = await prisma.post.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: postSelect(userId),
    });

    const isAdmin = (page.admins as any[]).some((a) => a.userId === userId);
    res.json({
      ok: true,
      page: {
        id: page.id, name: page.name, slug: page.slug, bio: page.bio,
        category: page.category, avatarUrl: page.avatarUrl, createdAt: page.createdAt,
        followerCount: (page.followers as any[]).length,
        followedByMe: (page.followers as any[]).some((f) => f.userId === userId),
        isAdmin,
      },
      posts: posts.map(shapePost),
    });
  })
);

// ---------------------------------------------------------------
// POST /api/pages/:slug/follow — toggle متابعة صفحة
// ---------------------------------------------------------------
pagesRouter.post(
  "/:slug/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const page = await prisma.page.findUnique({ where: { slug: req.params.slug! }, select: { id: true } });
    if (!page) throw Errors.notFound("Page");

    const existing = await prisma.pageFollower.findUnique({
      where: { pageId_userId: { pageId: page.id, userId } },
    });

    if (existing) {
      await prisma.pageFollower.delete({ where: { pageId_userId: { pageId: page.id, userId } } });
      const followerCount = await prisma.pageFollower.count({ where: { pageId: page.id } });
      return res.json({ ok: true, following: false, followerCount });
    }

    await prisma.pageFollower.create({ data: { pageId: page.id, userId } });
    const followerCount = await prisma.pageFollower.count({ where: { pageId: page.id } });
    res.json({ ok: true, following: true, followerCount });
  })
);

// ---------------------------------------------------------------
// POST /api/pages/:slug/posts — نشر باسم الصفحة (الأدمنّات/المحررين بس)
// ---------------------------------------------------------------
pagesRouter.post(
  "/:slug/posts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const page = await prisma.page.findUnique({ where: { slug: req.params.slug! }, select: { id: true } });
    if (!page) throw Errors.notFound("Page");

    const admin = await prisma.pageAdmin.findUnique({
      where: { pageId_userId: { pageId: page.id, userId } },
    });
    if (!admin) throw Errors.forbidden("Only page admins can post");

    const input = createPostSchema.parse(req.body);
    const post = await prisma.post.create({
      data: {
        authorId: userId,
        pageId: page.id,
        type: input.type,
        title: input.title ?? null,
        body: input.body,
        codeLanguage: input.type === "SNIPPET" ? input.codeLanguage : null,
        codeContent: input.type === "SNIPPET" ? input.codeContent : null,
        imageUrl: input.imageUrl ?? null,
      },
      select: postSelect(userId),
    });

    res.status(201).json({ ok: true, post: shapePost(post) });
  })
);

// ---------------------------------------------------------------
// PATCH /api/pages/:slug — تعديل الصفحة (ADMIN بس)
// GET /api/pages/:slug/followers — المتابعين
// POST /api/pages/:slug/admins — إضافة أدمن | DELETE — إزالة أدمن
// ---------------------------------------------------------------
async function requirePageAdmin(slug: string, userId: string) {
  const page = await prisma.page.findUnique({ where: { slug }, select: { id: true } });
  if (!page) throw Errors.notFound("Page");
  const admin = await prisma.pageAdmin.findUnique({
    where: { pageId_userId: { pageId: page.id, userId } },
  });
  if (!admin || admin.role !== "ADMIN") throw Errors.forbidden("Only page admins can do this");
  return page;
}

pagesRouter.patch(
  "/:slug",
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = await requirePageAdmin(req.params.slug!, req.user!.userId);
    const input = z.object({
      name: z.string().min(2).max(60).optional(),
      bio: z.string().max(500).optional(),
      avatarUrl: httpUrl().or(z.literal("")).optional(), // [SECURITY] http(s) بس — بتتعرض في src/href
    }).parse(req.body);

    const updated = await prisma.page.update({
      where: { id: page.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl || null } : {}),
      },
      select: { id: true, name: true, slug: true, bio: true, avatarUrl: true },
    });
    res.json({ ok: true, page: updated });
  })
);

pagesRouter.get(
  "/:slug/followers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = await prisma.page.findUnique({ where: { slug: req.params.slug! }, select: { id: true } });
    if (!page) throw Errors.notFound("Page");
    const [followers, admins] = await Promise.all([
      prisma.pageFollower.findMany({
        where: { pageId: page.id },
        select: { user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } } },
      }),
      prisma.pageAdmin.findMany({ where: { pageId: page.id }, select: { userId: true, role: true, user: { select: { username: true } } } }),
    ]);
    const adminUsernames = admins.map((a: any) => a.user?.username).filter(Boolean);
    res.json({
      ok: true,
      followers: followers.map((f: any) => ({ ...f.user, isAdmin: adminUsernames.includes(f.user.username) })),
    });
  })
);

pagesRouter.post(
  "/:slug/admins",
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = await requirePageAdmin(req.params.slug!, req.user!.userId);
    const { username } = z.object({ username: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) throw Errors.notFound("User");
    const existing = await prisma.pageAdmin.findUnique({ where: { pageId_userId: { pageId: page.id, userId: user.id } } });
    if (existing) throw Errors.conflict("Already an admin");
    await prisma.pageAdmin.create({ data: { pageId: page.id, userId: user.id, role: "ADMIN" } });
    res.status(201).json({ ok: true });
  })
);

pagesRouter.delete(
  "/:slug/admins/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = await requirePageAdmin(req.params.slug!, req.user!.userId);
    const user = await prisma.user.findUnique({ where: { username: req.params.username! }, select: { id: true } });
    if (!user) throw Errors.notFound("User");
    if (user.id === req.user!.userId) throw Errors.badRequest("You can't remove yourself");
    await prisma.pageAdmin.delete({ where: { pageId_userId: { pageId: page.id, userId: user.id } } }).catch(() => {});
    res.json({ ok: true });
  })
);

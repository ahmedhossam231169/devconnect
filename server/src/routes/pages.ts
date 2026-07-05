import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { createPostSchema } from "../schemas/posts.js";

export const pagesRouter = Router();

export const PAGE_CATEGORIES = ["Company", "Project", "Open Source", "Community", "Product"] as const;

const createPageSchema = z.object({
  name: z.string().min(2, "Name is too short").max(60),
  bio: z.string().max(500).optional(),
  category: z.enum(PAGE_CATEGORIES),
});

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
async function uniqueSlug(base: string): Promise<string> {
  let slug = base || "page";
  let i = 1;
  while (await prisma.page.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base}-${++i}`;
  }
  return slug;
}

const postSelect = (viewerId: string) =>
  ({
    id: true, type: true, title: true, body: true,
    codeLanguage: true, codeContent: true, createdAt: true,
    author: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true, headline: true } } } },
    _count: { select: { likes: true, comments: true } },
    likes: { where: { userId: viewerId }, select: { userId: true } },
  }) as const;

function shapePost(p: any) {
  const { likes, _count, ...rest } = p;
  return { ...rest, likeCount: _count.likes, commentCount: _count.comments, likedByMe: likes.length > 0 };
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
    const slug = await uniqueSlug(slugify(input.name));

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
      },
      select: postSelect(userId),
    });

    res.status(201).json({ ok: true, post: shapePost(post) });
  })
);

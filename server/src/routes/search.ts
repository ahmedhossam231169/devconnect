import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const searchRouter = Router();

// ---------------------------------------------------------------
// GET /api/search?q=... — بحث في المطورين والبوستات
// بحث بسيط بـ contains (case-insensitive) — كافي لحجمنا الحالي
// للأحجام الكبيرة لاحقًا: Postgres full-text search أو Meilisearch
// ---------------------------------------------------------------
searchRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) {
      return res.json({ ok: true, users: [], posts: [] });
    }

    const [users, posts] = await Promise.all([
      // المستخدمين: بحث في الـ username والاسم والـ headline والتخصص
      prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: q, mode: "insensitive" } },
            { profile: { displayName: { contains: q, mode: "insensitive" } } },
            { profile: { headline: { contains: q, mode: "insensitive" } } },
            { profile: { specialty: { contains: q, mode: "insensitive" } } },
          ],
        },
        take: 8,
        select: {
          username: true,
          profile: { select: { displayName: true, avatarUrl: true, headline: true, specialty: true } },
        },
      }),
      // البوستات العامة بس (مش بوستات المجتمعات/الصفحات الخاصة)
      prisma.post.findMany({
        where: {
          communityId: null,
          pageId: null,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { body: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          createdAt: true,
          author: { select: { username: true, profile: { select: { displayName: true } } } },
        },
      }),
    ]);

    const shapedUsers = users.map((u: any) => ({
      username: u.username,
      displayName: u.profile?.displayName ?? u.username,
      avatarUrl: u.profile?.avatarUrl ?? null,
      headline: u.profile?.headline ?? null,
      specialty: u.profile?.specialty ?? null,
    }));

    const shapedPosts = posts.map((p: any) => ({
      id: p.id,
      title: p.title,
      // مقتطف قصير من الـ body
      excerpt: p.body.length > 120 ? p.body.slice(0, 120) + "..." : p.body,
      type: p.type,
      authorName: p.author.profile?.displayName ?? p.author.username,
      authorUsername: p.author.username,
      createdAt: p.createdAt,
    }));

    res.json({ ok: true, users: shapedUsers, posts: shapedPosts });
  })
);

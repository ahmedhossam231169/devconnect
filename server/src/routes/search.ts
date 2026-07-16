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
      return res.json({ ok: true, users: [], posts: [], communities: [] });
    }

    const me = req.user!.userId;
    // [SECURITY BUG-04] استبعاد أي طرف في علاقة حظر (في أي اتجاه) من النتايج
    const notBlocked = {
      blocksMade: { none: { blockedId: me } }, // هو حظرني
      blocksReceived: { none: { blockerId: me } }, // أنا حظرته
    };

    const [users, posts, communities] = await Promise.all([
      // المستخدمين: بحث في الـ username والاسم والـ headline والتخصص
      prisma.user.findMany({
        where: {
          AND: [
            {
              OR: [
                { username: { contains: q, mode: "insensitive" } },
                { profile: { displayName: { contains: q, mode: "insensitive" } } },
                { profile: { headline: { contains: q, mode: "insensitive" } } },
                { profile: { specialty: { contains: q, mode: "insensitive" } } },
              ],
            },
            notBlocked,
          ],
        },
        take: 20,
        select: {
          username: true,
          profile: { select: { displayName: true, avatarUrl: true, headline: true, specialty: true } },
        },
      }),
      // البوستات العامة بس (مش بوستات المجتمعات الخاصة)
      prisma.post.findMany({
        where: {
          communityId: null,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { body: { contains: q, mode: "insensitive" } },
          ],
          author: notBlocked, // [SECURITY BUG-04] مايظهرش بوستات طرف محظور
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          createdAt: true,
          author: { select: { username: true, profile: { select: { displayName: true } } } },
        },
      }),
      // الكوميونتيز — بحث بالاسم أو الوصف (نفس منطق الـ Hub)
      prisma.community.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          category: true,
          avatarUrl: true,
          isPrivate: true,
          members: { where: { userId: me }, select: { userId: true } },
          _count: { select: { members: true } },
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

    const shapedCommunities = communities.map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      category: c.category,
      avatarUrl: c.avatarUrl ?? null,
      isPrivate: c.isPrivate,
      memberCount: c._count.members,
      joinedByMe: c.members.length > 0,
    }));

    res.json({ ok: true, users: shapedUsers, posts: shapedPosts, communities: shapedCommunities });
  })
);

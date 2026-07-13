import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const feedRouter = Router();

// ---------------------------------------------------------------
// GET /api/feed/sidebar — كل داتا ويدجتات الفيد في طلب واحد:
//   trending   : أكتر الـ hashtags/اللغات ذكرًا آخر أسبوع + نسبة التغيير
//   risingStars: مطورين نشطين مش متابعهم (مرتبين بلايكات آخر 30 يوم)
//   activeHubs : أكبر الكوميونتيهات بعدد الأعضاء + نشاط الأسبوع
//   myStats    : مشاهدات بروفايلي + إجمالي اللايكات على بوستاتي
// ---------------------------------------------------------------

const WEEK = 7 * 24 * 60 * 60 * 1000;

// بنطلع التاجات من نص البوست: #hashtags + لغة الـ snippet
function extractTags(p: { title: string | null; body: string; codeLanguage: string | null }): string[] {
  const text = `${p.title ?? ""} ${p.body}`;
  const tags = new Set<string>();
  for (const m of text.matchAll(/#([A-Za-z][\w.+#-]{1,29})/g)) {
    tags.add(m[1]!.toLowerCase());
  }
  if (p.codeLanguage) tags.add(p.codeLanguage.toLowerCase());
  return [...tags];
}

feedRouter.get(
  "/sidebar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = req.user!.userId;
    const now = Date.now();
    const weekAgo = new Date(now - WEEK);
    const twoWeeksAgo = new Date(now - 2 * WEEK);
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [
      recentPosts,       // آخر أسبوعين — للـ trending
      monthPosts,        // آخر 30 يوم مع لايكاتهم — للـ rising stars
      topCommunities,
      myFollows,
      myBlocks,
      myProfile,
      myUpvotes,
    ] = await Promise.all([
      prisma.post.findMany({
        where: { createdAt: { gte: twoWeeksAgo } },
        select: { title: true, body: true, codeLanguage: true, createdAt: true },
        take: 1000,
        orderBy: { createdAt: "desc" },
      }),
      prisma.post.findMany({
        where: { createdAt: { gte: monthAgo } },
        select: {
          author: {
            select: {
              id: true,
              username: true,
              profile: { select: { displayName: true, avatarUrl: true, headline: true, specialty: true } },
            },
          },
          _count: { select: { likes: true } },
        },
        take: 500,
        orderBy: { createdAt: "desc" },
      }),
      prisma.community.findMany({
        orderBy: { members: { _count: "desc" } },
        take: 3,
        select: {
          name: true,
          slug: true,
          category: true,
          isPrivate: true,
          _count: { select: { members: true, posts: { where: { createdAt: { gte: weekAgo } } } } },
        },
      }),
      prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }),
      prisma.block.findMany({
        where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
        select: { blockerId: true, blockedId: true },
      }),
      prisma.profile.findUnique({ where: { userId: viewerId }, select: { profileViews: true } }),
      prisma.like.count({ where: { post: { authorId: viewerId } } }),
    ]);

    // ---- Trending: عدّ التاجات أسبوع حالي مقابل الأسبوع اللي قبله ----
    const cur = new Map<string, number>();
    const prev = new Map<string, number>();
    for (const p of recentPosts) {
      const bucket = +p.createdAt >= now - WEEK ? cur : prev;
      for (const t of extractTags(p)) bucket.set(t, (bucket.get(t) ?? 0) + 1);
    }
    const trending = [...cur.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([tag, count]) => {
        const before = prev.get(tag) ?? 0;
        const changePct = Math.round(((count - before) / Math.max(before, 1)) * 100);
        return { tag, count, changePct };
      });

    // ---- Rising stars: مجموع لايكات بوستات آخر شهر لكل مطوّر ----
    const excluded = new Set<string>([viewerId]);
    for (const f of myFollows) excluded.add(f.followingId);
    for (const b of myBlocks) { excluded.add(b.blockerId); excluded.add(b.blockedId); }

    const byAuthor = new Map<string, { user: (typeof monthPosts)[number]["author"]; score: number }>();
    for (const p of monthPosts) {
      if (excluded.has(p.author.id)) continue;
      const entry = byAuthor.get(p.author.id) ?? { user: p.author, score: 0 };
      entry.score += 1 + p._count.likes * 2; // بوست = نقطة، اللايك عليه = نقطتين
      byAuthor.set(p.author.id, entry);
    }
    const risingStars = [...byAuthor.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ user }) => ({
        username: user.username,
        displayName: user.profile?.displayName ?? user.username,
        avatarUrl: user.profile?.avatarUrl ?? null,
        headline: user.profile?.headline ?? user.profile?.specialty ?? null,
      }));

    // ---- Active hubs ----
    const activeHubs = topCommunities.map((c) => ({
      name: c.name,
      slug: c.slug,
      category: c.category,
      isPrivate: c.isPrivate,
      memberCount: c._count.members,
      postsThisWeek: c._count.posts,
    }));

    res.json({
      ok: true,
      trending,
      risingStars,
      activeHubs,
      myStats: { profileViews: myProfile?.profileViews ?? 0, upvotes: myUpvotes },
    });
  })
);

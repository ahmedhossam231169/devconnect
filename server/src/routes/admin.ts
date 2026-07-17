import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

// ---------------------------------------------------------------
// /api/admin — سطح المراجعة للمشرفين
// كل المسارات هنا محمية بـ requireAuth + requireAdmin (بترجع 404 لغير الأدمن).
// ده الـ API اللي الـ dashboard هيستهلكه بعدين — مفيش UI هنا.
// ---------------------------------------------------------------
export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------
// GET /api/admin/reports — طابور المراجعة
// ?status=PENDING&cursor=<id>&limit=25
// ---------------------------------------------------------------
const listQuerySchema = z.object({
  status: z.enum(["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// البلاغ بيشاور على البوست/اليوزر بـ id سايب من غير foreign key (اقرا السبب في
// schema.prisma). فبنجيب الأهداف على دفعتين استعلام بس — مش استعلام لكل بلاغ.
async function loadTargets(reports: { targetPostId: string | null; targetUserId: string | null }[]) {
  const postIds = [...new Set(reports.map((r) => r.targetPostId).filter((id): id is string => !!id))];
  const userIds = [...new Set(reports.map((r) => r.targetUserId).filter((id): id is string => !!id))];

  const [posts, users] = await Promise.all([
    postIds.length
      ? prisma.post.findMany({
          where: { id: { in: postIds } },
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            createdAt: true,
            communityId: true,
            author: { select: { username: true, profile: { select: { displayName: true } } } },
          },
        })
      : [],
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            username: true,
            createdAt: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        })
      : [],
  ]);

  return {
    posts: new Map(posts.map((p) => [p.id, p])),
    users: new Map(users.map((u) => [u.id, u])),
  };
}

// الهدف ممكن يكون اتمسح بعد البلاغ — بنرجّع deleted: true بدل ما نخفي البلاغ.
// المشرف لازم يشوف إن في بلاغ اتقدّم حتى لو المحتوى راح.
function shapeTarget(
  report: { targetPostId: string | null; targetUserId: string | null },
  targets: Awaited<ReturnType<typeof loadTargets>>
) {
  if (report.targetPostId) {
    const post = targets.posts.get(report.targetPostId);
    if (!post) return { kind: "post" as const, id: report.targetPostId, deleted: true };
    return {
      kind: "post" as const,
      id: post.id,
      deleted: false,
      type: post.type,
      title: post.title,
      // مقتطف بس — المراجعة مش محتاجة الـ body كامل في القايمة
      excerpt: post.body.slice(0, 280),
      createdAt: post.createdAt,
      inCommunity: !!post.communityId,
      author: {
        username: post.author.username,
        displayName: post.author.profile?.displayName ?? null,
      },
    };
  }
  if (report.targetUserId) {
    const user = targets.users.get(report.targetUserId);
    if (!user) return { kind: "user" as const, id: report.targetUserId, deleted: true };
    return {
      kind: "user" as const,
      id: user.id,
      deleted: false,
      username: user.username,
      displayName: user.profile?.displayName ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      joinedAt: user.createdAt,
    };
  }
  return null;
}

const reporterSelect = {
  username: true,
  profile: { select: { displayName: true } },
} as const;

adminRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const { status, cursor, limit } = listQuerySchema.parse(req.query);

    const reports = await prisma.report.findMany({
      where: status ? { status } : undefined,
      // الأقدم الأول: طابور مراجعة، مش feed. البلاغ اللي مستني من امبارح
      // أولى من اللي دخل دلوقتي.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1, // بنجيب واحد زيادة عشان نعرف في تاني ولا لأ
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        reason: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        resolutionNote: true,
        targetPostId: true,
        targetUserId: true,
        reporter: { select: reporterSelect },
        reviewer: { select: { username: true } },
      },
    });

    const hasMore = reports.length > limit;
    const page = hasMore ? reports.slice(0, limit) : reports;
    const targets = await loadTargets(page);

    res.json({
      ok: true,
      reports: page.map((r) => ({
        id: r.id,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        resolutionNote: r.resolutionNote,
        reporter: {
          username: r.reporter.username,
          displayName: r.reporter.profile?.displayName ?? null,
        },
        reviewer: r.reviewer?.username ?? null,
        target: shapeTarget(r, targets),
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    });
  })
);

// ---------------------------------------------------------------
// GET /api/admin/reports/stats — عدّاد لكل حالة (شارة الطابور)
// ---------------------------------------------------------------
adminRouter.get(
  "/reports/stats",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.report.groupBy({ by: ["status"], _count: { _all: true } });

    // groupBy بيرجّع الحالات اللي ليها صفوف بس — بنبدأ من صفر عشان الرد
    // يبقى شكله ثابت بدل ما مفتاح يختفي لما الطابور يفضى
    const stats = { PENDING: 0, REVIEWING: 0, RESOLVED: 0, DISMISSED: 0 };
    for (const row of rows) stats[row.status] = row._count._all;

    res.json({ ok: true, stats, total: Object.values(stats).reduce((a, b) => a + b, 0) });
  })
);

// ---------------------------------------------------------------
// GET /api/admin/reports/:id — بلاغ واحد بتفاصيله الكاملة
// ---------------------------------------------------------------
adminRouter.get(
  "/reports/:id",
  asyncHandler(async (req, res) => {
    const report = await prisma.report.findUnique({
      where: { id: req.params.id! },
      select: {
        id: true,
        reason: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        resolutionNote: true,
        targetPostId: true,
        targetUserId: true,
        reporter: { select: reporterSelect },
        reviewer: { select: { username: true } },
      },
    });
    if (!report) throw Errors.notFound("Report");

    const targets = await loadTargets([report]);
    const target = shapeTarget(report, targets);

    // في صفحة البلاغ الواحد بنرجّع الـ body كامل — المشرف محتاج يشوف
    // المحتوى كله عشان ياخد قرار، مش مقتطف
    let fullBody: string | null = null;
    if (report.targetPostId) {
      const post = targets.posts.get(report.targetPostId);
      fullBody = post?.body ?? null;
    }

    // بلاغات تانية على نفس الهدف — نمط متكرر معناه مشكلة حقيقية مش خلاف فردي
    const relatedCount = await prisma.report.count({
      where: {
        id: { not: report.id },
        ...(report.targetPostId
          ? { targetPostId: report.targetPostId }
          : { targetUserId: report.targetUserId }),
      },
    });

    res.json({
      ok: true,
      report: {
        id: report.id,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
        reviewedAt: report.reviewedAt,
        resolutionNote: report.resolutionNote,
        reporter: {
          username: report.reporter.username,
          displayName: report.reporter.profile?.displayName ?? null,
        },
        reviewer: report.reviewer?.username ?? null,
        target,
        fullBody,
        relatedCount,
      },
    });
  })
);

// ---------------------------------------------------------------
// PATCH /api/admin/reports/:id — تغيير حالة البلاغ
// ---------------------------------------------------------------
const reviewSchema = z.object({
  status: z.enum(["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"]),
  resolutionNote: z.string().trim().max(1000).optional(),
});

adminRouter.patch(
  "/reports/:id",
  asyncHandler(async (req, res) => {
    const input = reviewSchema.parse(req.body);
    const id = req.params.id!;

    const existing = await prisma.report.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound("Report");

    // رجوع البلاغ لـ PENDING معناه إنه رجع للطابور — فبنمسح بيانات المراجعة
    // بدل ما نسيب مراجع متسجّل على بلاغ محدش بيراجعه
    const clearing = input.status === "PENDING";

    const report = await prisma.report.update({
      where: { id },
      data: {
        status: input.status,
        reviewedAt: clearing ? null : new Date(),
        reviewedById: clearing ? null : req.user!.userId,
        ...(input.resolutionNote !== undefined ? { resolutionNote: input.resolutionNote } : {}),
      },
      select: {
        id: true,
        status: true,
        reviewedAt: true,
        resolutionNote: true,
        reviewer: { select: { username: true } },
      },
    });

    res.json({
      ok: true,
      report: { ...report, reviewer: report.reviewer?.username ?? null },
    });
  })
);

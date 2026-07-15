import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { updateProfileSchema } from "../schemas/profile.js";
import { calculateReputation } from "../lib/reputation.js";
import { isBlockedBetween } from "../lib/blocks.js";

export const profilesRouter = Router();

// شكل موحد للبروفايل الكامل — نفس الشكل في صفحة "المرحلة 5" للمرشح
const fullProfileSelect = {
  id: true,
  displayName: true,
  headline: true,
  bio: true,
  avatarUrl: true,
  location: true,
  yearsExperience: true,
  specialty: true,
  companyName: true,
  availability: true,
  websiteUrl: true,
  githubUrl: true,
  githubUsername: true,
  onboarded: true,
  discoverable: true,
  bannerUrl: true,
  resumeUrl: true,
  profileViews: true,
  experiences: {
    select: { id: true, title: true, company: true, startYear: true, endYear: true, description: true },
    // الوظيفة الحالية (endYear=null) الأول، وبعدين الأحدث فالأقدم
    orderBy: { startYear: "desc" },
  },
  skills: {
    select: { years: true, skill: { select: { name: true } } },
    orderBy: { years: "desc" },
  },
} as const;

function shapeProfile(p: any) {
  if (!p) return null;
  const { skills, ...rest } = p;
  return {
    ...rest,
    skills: skills.map((s: any) => ({ name: s.skill.name, years: s.years })),
  };
}

// ---------------------------------------------------------------
// GET /api/profiles/me — بروفايلي أنا (عشان صفحة "Edit Profile")
// ---------------------------------------------------------------
profilesRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await prisma.profile.findUnique({
      where: { userId: req.user!.userId },
      select: fullProfileSelect,
    });
    if (!profile) throw Errors.notFound("Profile");
    res.json({ ok: true, profile: shapeProfile(profile) });
  })
);

// ---------------------------------------------------------------
// PUT /api/profiles/me — تحديث البروفايل + الـ skills
// ---------------------------------------------------------------
profilesRouter.put(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    const userId = req.user!.userId;
    const { skills, experiences, ...scalarFields } = input;

    // 1) تحديث الحقول العادية
    if (Object.keys(scalarFields).length > 0) {
      await prisma.profile.update({ where: { userId }, data: scalarFields });
    }

    // 1.5) الخبرات الوظيفية: استبدال كامل (نفس أسلوب الـ skills تحت)
    if (experiences) {
      const profile = await prisma.profile.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });
      await prisma.experience.deleteMany({ where: { profileId: profile.id } });
      if (experiences.length > 0) {
        await prisma.experience.createMany({
          data: experiences.map((e) => ({
            profileId: profile.id,
            title: e.title,
            company: e.company,
            startYear: e.startYear,
            endYear: e.endYear ?? null,
            description: e.description ?? null,
          })),
        });
      }
    }

    // 2) الـ skills: بنمسح القديم ونحط الجديد (بسيط وآمن ضد تكرار)
    //    لكل skill لازم نتأكد إنه موجود في جدول Skill المشترك (upsert) قبل ما نربطه
    if (skills) {
      const profile = await prisma.profile.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });

      await prisma.profileSkill.deleteMany({ where: { profileId: profile.id } });

      for (const s of skills) {
        const skill = await prisma.skill.upsert({
          where: { name: s.name },
          update: {},
          create: { name: s.name },
        });
        await prisma.profileSkill.create({
          data: { profileId: profile.id, skillId: skill.id, years: s.years },
        });
      }
    }

    const updated = await prisma.profile.findUnique({
      where: { userId },
      select: fullProfileSelect,
    });
    res.json({ ok: true, profile: shapeProfile(updated) });
  })
);

// ---------------------------------------------------------------
// GET /api/profiles/:username — بروفايل عام (recruiters بيستخدموه لصفحة المرشح)
// ---------------------------------------------------------------
profilesRouter.get(
  "/:username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username! },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        profile: { select: fullProfileSelect },
      },
    });
    if (!user || !user.profile) throw Errors.notFound("Profile");
    // [SECURITY BUG-04] لو في حظر بين الطرفين، اعرض كأنه مش موجود (إخفاء متبادل)
    if (await isBlockedBetween(req.user!.userId, user.id)) throw Errors.notFound("Profile");

    // عداد المشاهدات — زيارات الآخرين بس (مش صاحب البروفايل)
    if (user.id !== req.user!.userId) {
      await prisma.profile.update({
        where: { userId: user.id },
        data: { profileViews: { increment: 1 } },
      });
    }

    const reputation = await calculateReputation(user.id);

    // عدد المتابعين — بيظهر في شريط إحصائيات البروفايل في الديزاين
    const followers = await prisma.follow.count({ where: { followingId: user.id } });

    const profile = shapeProfile(user.profile) as any;
    // الـ CV للـ recruiters وصاحب البروفايل بس — "VERIFIED RECRUITER ACCESS ONLY"
    const isOwner = user.id === req.user!.userId;
    if (!isOwner && req.user!.role !== "RECRUITER") {
      profile.resumeUrl = null;
    }

    res.json({
      ok: true,
      user: { username: user.username, role: user.role, createdAt: user.createdAt },
      profile,
      reputation,
      followers,
    });
  })
);

// ---------------------------------------------------------------
// GET /api/profiles/:username/activity — آخر نشاط حقيقي للمستخدم:
// بوستات نشرها + كوميونتيهات انضم لها (للـ Activity Feed في البروفايل)
// ---------------------------------------------------------------
profilesRouter.get(
  "/:username/activity",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username! },
      select: { id: true },
    });
    if (!user) throw Errors.notFound("Profile");
    if (await isBlockedBetween(req.user!.userId, user.id)) throw Errors.notFound("Profile");

    const [posts, memberships] = await Promise.all([
      prisma.post.findMany({
        where: { authorId: user.id, communityId: null, pageId: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, type: true, title: true, createdAt: true },
      }),
      prisma.communityMember.findMany({
        where: { userId: user.id, community: { isPrivate: false } },
        orderBy: { joinedAt: "desc" },
        take: 3,
        select: { joinedAt: true, community: { select: { name: true, slug: true } } },
      }),
    ]);

    type Item =
      | { kind: "post"; at: Date; postId: string; postType: string; title: string | null }
      | { kind: "community"; at: Date; name: string; slug: string };

    const items: Item[] = [
      ...posts.map((p): Item => ({ kind: "post", at: p.createdAt, postId: p.id, postType: p.type, title: p.title })),
      ...memberships.map((m): Item => ({ kind: "community", at: m.joinedAt, name: m.community.name, slug: m.community.slug })),
    ]
      .sort((a, b) => +b.at - +a.at)
      .slice(0, 6);

    res.json({ ok: true, items });
  })
);

// ---------------------------------------------------------------
// GET /api/profiles/:username/github-projects — مشاريع GitHub العامة
// بنجيبها من GitHub API مباشرة (مش بنخزنها) — دايمًا محدّثة
// ---------------------------------------------------------------
interface GitHubRepo {
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  fork: boolean;
}

// ---------------------------------------------------------------
// GitHub API helper — token اختياري + كاش في الذاكرة
// من غير GITHUB_TOKEN الحد 60 طلب/ساعة *للـ IP كله* — على استضافة
// مشتركة (Render) بينفد فورًا. بالـ token بيبقى 5000/ساعة.
// الكاش بيوفر الطلبات أصلًا: نفس البروفايل مش بيتسأل من GitHub
// غير مرة كل 10 دقايق مهما اتفتح.
// ---------------------------------------------------------------
const ghCache = new Map<string, { at: number; data: unknown }>();
const GH_CACHE_TTL = 10 * 60 * 1000;

type GhResult =
  | { ok: true; data: unknown }
  | { ok: false; rateLimited: boolean; status: number };

async function ghJson(url: string): Promise<GhResult> {
  const cached = ghCache.get(url);
  if (cached && Date.now() - cached.at < GH_CACHE_TTL) {
    return { ok: true, data: cached.data };
  }

  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      // 403/429 مع remaining=0 = rate limit — بنفرّقها عشان الرسالة للمستخدم تبقى صادقة
      const rateLimited =
        (res.status === 403 || res.status === 429) &&
        res.headers.get("x-ratelimit-remaining") === "0";
      return { ok: false, rateLimited, status: res.status };
    }
    const data = (await res.json()) as unknown;
    ghCache.set(url, { at: Date.now(), data });
    return { ok: true, data };
  } catch {
    return { ok: false, rateLimited: false, status: 0 };
  }
}

profilesRouter.get(
  "/:username/github-projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username! },
      select: { id: true, githubId: true, profile: { select: { githubUsername: true } } },
    });
    if (!user?.profile) throw Errors.notFound("Profile");
    // [SECURITY BUG-04] المحظور مايشوفش مشاريع GitHub بتاعت اللي حظره
    if (await isBlockedBetween(req.user!.userId, user.id)) throw Errors.notFound("Profile");

    // [SECURITY] الـ repos بتتعرض فقط لحساب GitHub متوثق بـ OAuth (githubId موجود)
    // — الـ githubUrl المكتوب باليد في البروفايل مجرد لينك ومابيثبتش ملكية،
    // ومن غير الشرط ده أي حد يقدر يعرض مشاريع أي حد تاني على إنها بتاعته
    const ghUsername = user.githubId ? user.profile.githubUsername : null;
    if (!ghUsername) {
      return res.json({ ok: true, projects: [], stats: null, githubConnected: false });
    }

    // الـ repos + بيانات الحساب في نفس الوقت — عشان نطلع stats كمان
    const [reposResult, userResult] = await Promise.all([
      ghJson(`https://api.github.com/users/${ghUsername}/repos?sort=updated&per_page=100`),
      ghJson(`https://api.github.com/users/${ghUsername}`),
    ]);
    if (!reposResult.ok) {
      // بنقول للـ client السبب الحقيقي — عشان ما يعرضش "مفيش مشاريع" وهي موجودة
      return res.json({
        ok: true,
        projects: [],
        stats: null,
        githubConnected: true,
        error: reposResult.rateLimited ? "rate_limited" : "unavailable",
      });
    }
    {
      const repos = reposResult.data as GitHubRepo[];
      const ghUser = userResult.ok
        ? (userResult.data as { public_repos: number; followers: number })
        : null;

      // نستبعد الـ forks ونرتب بالنجوم، ونرجّع الأهم بس
      const own = repos.filter((r) => !r.fork);
      const projects = own
        .sort((a, b) => b.stargazers_count - a.stargazers_count)
        .slice(0, 6)
        .map((r) => ({
          name: r.name,
          url: r.html_url,
          description: r.description,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          updatedAt: r.updated_at,
        }));

      // إحصائيات مجمّعة من الـ repos (بدون الـ forks) + بيانات الحساب
      const langCount: Record<string, number> = {};
      for (const r of own) {
        if (r.language) langCount[r.language] = (langCount[r.language] ?? 0) + 1;
      }
      const stats = {
        username: ghUsername,
        publicRepos: ghUser?.public_repos ?? own.length,
        followers: ghUser?.followers ?? 0,
        totalStars: own.reduce((s, r) => s + r.stargazers_count, 0),
        totalForks: own.reduce((s, r) => s + r.forks_count, 0),
        topLanguages: Object.entries(langCount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name, count]) => ({ name, count })),
      };

      res.json({ ok: true, projects, stats, githubConnected: true });
    }
  })
);

// [SECURITY] ربط GitHub بالكتابة (username/إيميل) اتشال نهائيًا —
// كان بيسمح لأي حد يعرض مشاريع أي حد تاني على إنها بتاعته.
// الربط دلوقتي عن طريق GitHub OAuth بس: GET /api/auth/github/connect-url

// ---------------------------------------------------------------
// POST /api/profiles/me/complete-onboarding — يعلّم إن المستخدم خلّص الترحيب
// ---------------------------------------------------------------
profilesRouter.post(
  "/me/complete-onboarding",
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.profile.update({
      where: { userId: req.user!.userId },
      data: { onboarded: true },
    });
    res.json({ ok: true });
  })
);

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

profilesRouter.get(
  "/:username/github-projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username! },
      select: { id: true, profile: { select: { githubUsername: true, githubUrl: true } } },
    });
    if (!user?.profile) throw Errors.notFound("Profile");
    // [SECURITY BUG-04] المحظور مايشوفش مشاريع GitHub بتاعت اللي حظره
    if (await isBlockedBetween(req.user!.userId, user.id)) throw Errors.notFound("Profile");

    // نستنتج username الـ GitHub: من الحقل المخصص، أو من الـ githubUrl
    let ghUsername = user.profile.githubUsername;
    if (!ghUsername && user.profile.githubUrl) {
      const match = user.profile.githubUrl.match(/github\.com\/([^/]+)/);
      ghUsername = match?.[1] ?? null;
    }
    if (!ghUsername) {
      return res.json({ ok: true, projects: [], stats: null, githubConnected: false });
    }

    try {
      // الـ repos + بيانات الحساب في نفس الوقت — عشان نطلع stats كمان
      const ghHeaders = { Accept: "application/vnd.github+json" };
      const [reposRes, userRes] = await Promise.all([
        fetch(`https://api.github.com/users/${ghUsername}/repos?sort=updated&per_page=100`, { headers: ghHeaders }),
        fetch(`https://api.github.com/users/${ghUsername}`, { headers: ghHeaders }),
      ]);
      if (!reposRes.ok) {
        return res.json({ ok: true, projects: [], stats: null, githubConnected: true, error: "Couldn't fetch repos" });
      }
      const repos = (await reposRes.json()) as GitHubRepo[];
      const ghUser = userRes.ok
        ? ((await userRes.json()) as { public_repos: number; followers: number })
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
    } catch {
      res.json({ ok: true, projects: [], stats: null, githubConnected: true, error: "GitHub is unavailable" });
    }
  })
);

// ---------------------------------------------------------------
// POST /api/profiles/me/github-link — ربط حساب GitHub بالبروفايل
// بيقبل username أو لينك بروفايل أو إيميل (لو الإيميل معلن على GitHub)
// للمستخدمين اللي سجلوا بإيميل/Google وعايزين يعرضوا مشاريعهم
// ---------------------------------------------------------------
import { z } from "zod";

const githubLinkSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your GitHub username or email").max(200),
});

profilesRouter.post(
  "/me/github-link",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { identifier } = githubLinkSchema.parse(req.body);
    const ghHeaders = { Accept: "application/vnd.github+json" };

    // 1) نستخرج الـ username من اللي المستخدم كتبه: لينك أو إيميل أو username
    let login: string | null = null;
    const urlMatch = identifier.match(/github\.com\/([A-Za-z0-9-]+)/i);
    if (urlMatch) {
      login = urlMatch[1]!;
    } else if (identifier.includes("@")) {
      // إيميل → GitHub search API (بيلاقي الحساب فقط لو الإيميل معلن في البروفايل)
      const sRes = await fetch(
        `https://api.github.com/search/users?q=${encodeURIComponent(identifier)}+in:email&per_page=1`,
        { headers: ghHeaders }
      );
      if (sRes.ok) {
        const s = (await sRes.json()) as { items?: { login: string }[] };
        login = s.items?.[0]?.login ?? null;
      }
      if (!login) {
        throw Errors.badRequest(
          "No GitHub account found with this email — it only works if the email is public on GitHub. Try your GitHub username instead."
        );
      }
    } else {
      login = identifier;
    }

    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) {
      throw Errors.badRequest("That doesn't look like a valid GitHub username");
    }

    // 2) نتأكد إن الحساب موجود فعلًا (وناخد الـ casing الرسمي بتاعه)
    const uRes = await fetch(`https://api.github.com/users/${login}`, { headers: ghHeaders });
    if (uRes.status === 404) throw Errors.notFound("GitHub account");
    if (!uRes.ok) throw Errors.internal("GitHub is unavailable right now — try again in a minute");
    const ghAccount = (await uRes.json()) as { login: string };

    // 3) نخزنه على البروفايل — من هنا ورايح المشاريع والـ stats بيظهروا تلقائيًا
    await prisma.profile.update({
      where: { userId: req.user!.userId },
      data: {
        githubUsername: ghAccount.login,
        githubUrl: `https://github.com/${ghAccount.login}`,
      },
    });

    res.json({ ok: true, githubUsername: ghAccount.login });
  })
);

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

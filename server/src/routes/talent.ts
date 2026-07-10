import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { talentSearchSchema } from "../schemas/profile.js";

export const talentRouter = Router();

// كل المسارات دي للـ recruiters بس
talentRouter.use(requireAuth, requireRole("RECRUITER"));

const candidateSelect = {
  id: true,
  displayName: true,
  headline: true,
  avatarUrl: true,
  location: true,
  yearsExperience: true,
  specialty: true,
  availability: true,
  user: { select: { username: true } },
  skills: {
    select: { years: true, skill: { select: { name: true } } },
    orderBy: { years: "desc" },
  },
} as const;

function shapeCandidate(p: any) {
  const { skills, user, ...rest } = p;
  return {
    ...rest,
    username: user.username,
    skills: skills.map((s: any) => ({ name: s.skill.name, years: s.years })),
  };
}

// ---------------------------------------------------------------
// GET /api/talent/search — recruiters بس (requireRole)
// كل حقول الفلتر اختيارية، بنبني الـ where clause ديناميكي حسب اللي اتبعت
// ---------------------------------------------------------------
talentRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = talentSearchSchema.parse(req.query);

    // كل عنصر هنا شرط لازم يتحقق — الـ skills بتتحول لشروط "AND" منفصلة
    // يعني لو الـ recruiter دور بـ React + TypeScript، المرشح لازم يملك الاتنين مع بعض
    const andConditions: any[] = [];

    if (q.specialty) andConditions.push({ specialty: q.specialty });
    if (q.availability) andConditions.push({ availability: q.availability });
    if (q.location) andConditions.push({ location: { contains: q.location, mode: "insensitive" } });
    if (q.minYears !== undefined) andConditions.push({ yearsExperience: { gte: q.minYears } });
    if (q.maxYears !== undefined) andConditions.push({ yearsExperience: { lte: q.maxYears } });
    if (q.q) {
      andConditions.push({
        OR: [
          { displayName: { contains: q.q, mode: "insensitive" } },
          { user: { username: { contains: q.q, mode: "insensitive" } } },
        ],
      });
    }
    for (const skillName of q.skills ?? []) {
      andConditions.push({ skills: { some: { skill: { name: { equals: skillName, mode: "insensitive" } } } } });
    }

    const where = andConditions.length ? { AND: andConditions } : {};

    const candidates = await prisma.profile.findMany({
      where,
      take: q.take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy: [{ yearsExperience: "desc" }, { id: "asc" }],
      select: candidateSelect,
    });

    const hasMore = candidates.length > q.take;
    const page = hasMore ? candidates.slice(0, q.take) : candidates;

    res.json({
      ok: true,
      candidates: page.map(shapeCandidate),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      appliedFilters: q,
    });
  })
);

// ---------------------------------------------------------------
// GET /api/talent/facets — قوائم الاختيار للفلتر (كل الـ skills المستخدمة فعليًا)
// عشان الـ UI يبني dropdown حقيقي من بيانات المشروع مش hardcoded
// ---------------------------------------------------------------
talentRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    const skills = await prisma.skill.findMany({
      select: { name: true },
      orderBy: { name: "asc" },
    });
    res.json({ ok: true, skills: skills.map((s: { name: string }) => s.name) });
  })
);

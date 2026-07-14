import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// ---------------------------------------------------------------
// Jobs & Hiring Pipeline — للـ recruiters بس
// الوظايف + ربط المرشحين بيها + مراحل الـ pipeline + KPIs الداشبورد
// ---------------------------------------------------------------

export const jobsRouter = Router();
jobsRouter.use(requireAuth, requireRole("RECRUITER"));

const STAGES = ["SOURCED", "SCREENING", "INTERVIEW", "OFFERED", "HIRED", "REJECTED"] as const;

const jobSchema = z.object({
  title: z.string().min(3, "Title is too short").max(80),
  description: z.string().max(2000).optional(),
  location: z.string().max(80).optional(),
  employmentType: z.string().max(40).optional(),
  skills: z.array(z.string().min(1).max(40)).max(15).default([]),
});

// حساب الـ match score: نسبة مهارات الوظيفة اللي المرشح عندها
export function matchScore(jobSkills: string[], candidateSkills: string[]): number | null {
  if (jobSkills.length === 0) return null;
  const set = new Set(candidateSkills.map((s) => s.toLowerCase()));
  const hits = jobSkills.filter((s) => set.has(s.toLowerCase())).length;
  return Math.round((hits / jobSkills.length) * 100);
}

const candidateBrief = {
  id: true,
  username: true,
  profile: {
    select: {
      displayName: true,
      avatarUrl: true,
      headline: true,
      specialty: true,
      availability: true,
      skills: { select: { skill: { select: { name: true } } } },
    },
  },
} as const;

function shapeApplication(a: any, jobSkills: string[]) {
  const skills = a.candidate.profile?.skills.map((s: any) => s.skill.name) ?? [];
  return {
    id: a.id,
    stage: a.stage,
    note: a.note,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    matchScore: matchScore(jobSkills, skills),
    candidate: {
      username: a.candidate.username,
      displayName: a.candidate.profile?.displayName ?? a.candidate.username,
      avatarUrl: a.candidate.profile?.avatarUrl ?? null,
      headline: a.candidate.profile?.headline ?? null,
      specialty: a.candidate.profile?.specialty ?? null,
      availability: a.candidate.profile?.availability ?? null,
    },
  };
}

// ---------------------------------------------------------------
// GET /api/jobs — وظايفي مع عدّادات المراحل
// ---------------------------------------------------------------
jobsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const jobs = await prisma.job.findMany({
      where: { recruiterId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        employmentType: true,
        skills: true,
        status: true,
        createdAt: true,
        applications: { select: { stage: true } },
      },
    });

    const shaped = jobs.map((j) => {
      const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<string, number>;
      for (const a of j.applications) counts[a.stage] = (counts[a.stage] ?? 0) + 1;
      const { applications, ...rest } = j;
      return { ...rest, candidateCount: applications.length, stageCounts: counts };
    });

    res.json({ ok: true, jobs: shaped });
  })
);

// ---------------------------------------------------------------
// POST /api/jobs — Post New Role
// ---------------------------------------------------------------
jobsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = jobSchema.parse(req.body);
    const job = await prisma.job.create({
      data: { ...input, recruiterId: req.user!.userId },
    });
    res.status(201).json({ ok: true, job });
  })
);

// helper: الوظيفة لازم تكون بتاعتي
async function myJob(jobId: string, recruiterId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, recruiterId } });
  if (!job) throw Errors.notFound("Job");
  return job;
}

// ---------------------------------------------------------------
// PATCH /api/jobs/:id — تعديل أو قفل الوظيفة
// ---------------------------------------------------------------
jobsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    await myJob(req.params.id!, req.user!.userId);
    const input = jobSchema.partial().extend({ status: z.enum(["OPEN", "CLOSED"]).optional() }).parse(req.body);
    const job = await prisma.job.update({ where: { id: req.params.id! }, data: input });
    res.json({ ok: true, job });
  })
);

// ---------------------------------------------------------------
// DELETE /api/jobs/:id
// ---------------------------------------------------------------
jobsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await myJob(req.params.id!, req.user!.userId);
    await prisma.job.delete({ where: { id: req.params.id! } });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------
// GET /api/jobs/:id/candidates — الـ pipeline بتاع وظيفة واحدة
// ---------------------------------------------------------------
jobsRouter.get(
  "/:id/candidates",
  asyncHandler(async (req, res) => {
    const job = await myJob(req.params.id!, req.user!.userId);
    const applications = await prisma.application.findMany({
      where: { jobId: job.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, stage: true, note: true, createdAt: true, updatedAt: true,
        candidate: { select: candidateBrief },
      },
    });
    res.json({ ok: true, applications: applications.map((a) => shapeApplication(a, job.skills)) });
  })
);

// ---------------------------------------------------------------
// POST /api/jobs/:id/candidates — Shortlist & Add to Pipeline
// [PRIVACY] نفس قاعدة الـ talent search: المرشح لازم يكون discoverable
// ---------------------------------------------------------------
jobsRouter.post(
  "/:id/candidates",
  asyncHandler(async (req, res) => {
    const job = await myJob(req.params.id!, req.user!.userId);
    const { username } = z.object({ username: z.string().min(1) }).parse(req.body);

    const candidate = await prisma.user.findUnique({
      where: { username },
      select: { id: true, role: true, profile: { select: { discoverable: true } } },
    });
    if (!candidate || candidate.role !== "DEVELOPER" || !candidate.profile?.discoverable) {
      throw Errors.notFound("Candidate");
    }

    const application = await prisma.application.upsert({
      where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } },
      update: {},
      create: { jobId: job.id, candidateId: candidate.id },
      select: {
        id: true, stage: true, note: true, createdAt: true, updatedAt: true,
        candidate: { select: candidateBrief },
      },
    });

    res.status(201).json({ ok: true, application: shapeApplication(application, job.skills) });
  })
);

// ---------------------------------------------------------------
// PATCH /api/jobs/applications/:id — تغيير المرحلة أو الملاحظة
// ---------------------------------------------------------------
jobsRouter.patch(
  "/applications/:id",
  asyncHandler(async (req, res) => {
    const input = z.object({
      stage: z.enum(STAGES).optional(),
      note: z.string().max(1000).nullable().optional(),
    }).parse(req.body);

    const existing = await prisma.application.findFirst({
      where: { id: req.params.id!, job: { recruiterId: req.user!.userId } },
      select: { id: true, job: { select: { skills: true } } },
    });
    if (!existing) throw Errors.notFound("Application");

    const application = await prisma.application.update({
      where: { id: existing.id },
      data: input,
      select: {
        id: true, stage: true, note: true, createdAt: true, updatedAt: true,
        candidate: { select: candidateBrief },
      },
    });
    res.json({ ok: true, application: shapeApplication(application, existing.job.skills) });
  })
);

// ---------------------------------------------------------------
// DELETE /api/jobs/applications/:id — شيل المرشح من الـ pipeline
// ---------------------------------------------------------------
jobsRouter.delete(
  "/applications/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.application.findFirst({
      where: { id: req.params.id!, job: { recruiterId: req.user!.userId } },
      select: { id: true },
    });
    if (!existing) throw Errors.notFound("Application");
    await prisma.application.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------
// GET /api/jobs/dashboard — KPIs الداشبورد + جدول الـ Talent Pool
// كله متحسب من الداتا الحقيقية (مفيش أرقام شكلية)
// ---------------------------------------------------------------
jobsRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const recruiterId = req.user!.userId;

    const [jobs, applications] = await Promise.all([
      prisma.job.findMany({
        where: { recruiterId },
        select: { id: true, title: true, skills: true, status: true },
      }),
      prisma.application.findMany({
        where: { job: { recruiterId } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true, jobId: true, stage: true, note: true, createdAt: true, updatedAt: true,
          candidate: { select: candidateBrief },
        },
      }),
    ]);

    const openRoles = jobs.filter((j) => j.status === "OPEN").length;
    const active = applications.filter((a) => a.stage !== "REJECTED" && a.stage !== "HIRED");
    // متوسط أيام التوظيف — من دخول الـ pipeline لحد HIRED
    const hired = applications.filter((a) => a.stage === "HIRED");
    const avgTimeToHire = hired.length
      ? Math.round(hired.reduce((s, a) => s + (+a.updatedAt - +a.createdAt), 0) / hired.length / 86_400_000)
      : null;
    // نسبة التحويل: اللي وصلوا OFFERED أو HIRED من إجمالي الـ pipeline
    const conversion = applications.length
      ? Math.round((applications.filter((a) => a.stage === "OFFERED" || a.stage === "HIRED").length / applications.length) * 100)
      : null;

    const stageDistribution = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<string, number>;
    for (const a of applications) stageDistribution[a.stage] = (stageDistribution[a.stage] ?? 0) + 1;

    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const pipeline = applications.slice(0, 25).map((a) => {
      const job = jobById.get(a.jobId);
      return {
        ...shapeApplication(a, job?.skills ?? []),
        job: { id: a.jobId, title: job?.title ?? "—" },
      };
    });

    res.json({
      ok: true,
      kpis: { openRoles, activeCandidates: active.length, avgTimeToHire, conversion },
      stageDistribution,
      pipeline,
    });
  })
);

// ---------------------------------------------------------------
// GET /api/jobs/candidate/:username — تواجد مرشح معيّن في pipelines وظايفي
// بتستخدمها صفحة الـ Candidate Detail (زر Reject وحالة الـ pipeline)
// ---------------------------------------------------------------
jobsRouter.get(
  "/candidate/:username",
  asyncHandler(async (req, res) => {
    const candidate = await prisma.user.findUnique({
      where: { username: req.params.username! },
      select: { id: true },
    });
    if (!candidate) throw Errors.notFound("Candidate");

    const applications = await prisma.application.findMany({
      where: { candidateId: candidate.id, job: { recruiterId: req.user!.userId } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        stage: true,
        note: true,
        job: { select: { id: true, title: true, skills: true, status: true } },
      },
    });

    res.json({ ok: true, applications });
  })
);

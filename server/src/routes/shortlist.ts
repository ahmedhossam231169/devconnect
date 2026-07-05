import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const shortlistRouter = Router();

// كل المسارات دي للـ recruiters بس
shortlistRouter.use(requireAuth, requireRole("RECRUITER"));

const saveSchema = z.object({
  username: z.string().min(1),
  note: z.string().max(1000).optional(),
});

async function findCandidate(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, role: true },
  });
  if (!user) throw Errors.notFound("User");
  return user;
}

// ---------------------------------------------------------------
// GET /api/shortlist — قائمة المرشحين المحفوظين
// ---------------------------------------------------------------
shortlistRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const entries = await prisma.shortlistEntry.findMany({
      where: { recruiterId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        note: true,
        createdAt: true,
        candidate: {
          select: {
            username: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
                headline: true,
                specialty: true,
                yearsExperience: true,
                availability: true,
              },
            },
          },
        },
      },
    });

    const shaped = entries.map((e: any) => ({
      id: e.id,
      note: e.note,
      createdAt: e.createdAt,
      username: e.candidate.username,
      displayName: e.candidate.profile?.displayName ?? e.candidate.username,
      avatarUrl: e.candidate.profile?.avatarUrl ?? null,
      headline: e.candidate.profile?.headline ?? null,
      specialty: e.candidate.profile?.specialty ?? null,
      yearsExperience: e.candidate.profile?.yearsExperience ?? null,
      availability: e.candidate.profile?.availability ?? null,
    }));

    res.json({ ok: true, shortlist: shaped });
  })
);

// ---------------------------------------------------------------
// GET /api/shortlist/check/:username — هل المرشح ده محفوظ؟ (لزر البروفايل)
// ---------------------------------------------------------------
shortlistRouter.get(
  "/check/:username",
  asyncHandler(async (req, res) => {
    const candidate = await findCandidate(req.params.username!);
    const entry = await prisma.shortlistEntry.findUnique({
      where: {
        recruiterId_candidateId: { recruiterId: req.user!.userId, candidateId: candidate.id },
      },
      select: { note: true },
    });
    res.json({ ok: true, saved: !!entry, note: entry?.note ?? null });
  })
);

// ---------------------------------------------------------------
// POST /api/shortlist — حفظ مرشح (أو تحديث ملاحظته لو محفوظ)
// ---------------------------------------------------------------
shortlistRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { username, note } = saveSchema.parse(req.body);
    const me = req.user!.userId;
    const candidate = await findCandidate(username);

    if (candidate.id === me) throw Errors.badRequest("You can't shortlist yourself");

    // upsert: لو محفوظ نحدّث الملاحظة، لو لأ ننشئ
    const entry = await prisma.shortlistEntry.upsert({
      where: { recruiterId_candidateId: { recruiterId: me, candidateId: candidate.id } },
      update: { note: note ?? null },
      create: { recruiterId: me, candidateId: candidate.id, note: note ?? null },
      select: { id: true, note: true },
    });

    res.status(201).json({ ok: true, entry });
  })
);

// ---------------------------------------------------------------
// DELETE /api/shortlist/:username — إزالة مرشح من القائمة
// ---------------------------------------------------------------
shortlistRouter.delete(
  "/:username",
  asyncHandler(async (req, res) => {
    const me = req.user!.userId;
    const candidate = await findCandidate(req.params.username!);

    const entry = await prisma.shortlistEntry.findUnique({
      where: { recruiterId_candidateId: { recruiterId: me, candidateId: candidate.id } },
    });
    if (!entry) throw Errors.notFound("Shortlist entry");

    await prisma.shortlistEntry.delete({
      where: { recruiterId_candidateId: { recruiterId: me, candidateId: candidate.id } },
    });
    res.json({ ok: true });
  })
);

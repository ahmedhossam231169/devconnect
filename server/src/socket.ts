import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { verifyToken, type TokenPayload } from "./lib/jwt.js";
import { prisma } from "./lib/prisma.js";
import { getAllowedOrigins } from "./lib/cors.js";
import { cloudinaryUrl } from "./schemas/profile.js";

// ---------------------------------------------------------------
// طبقة الـ real-time — Socket.io
// كل مستخدم متصل بينضم لروم باسمه user:{id}
// فإرسال رسالة = emit للروم بتاع الطرف التاني (كل أجهزته توصلها)
// ---------------------------------------------------------------

const sendMessageSchema = z
  .object({
    conversationId: z.string().min(1),
    // body ممكن يبقى فاضي لو الرسالة مرفق بس
    body: z.string().max(5000).default(""),
    codeLanguage: z.string().max(20).optional(),
    codeContent: z.string().max(10_000).optional(),
    // مرفق (اترفع على Cloudinary من الـ client) — لازم يكون على حسابنا (BUG-11)،
    // مش أي رابط. بيتعرض للطرف التاني في المحادثة كصورة/لينك تحميل.
    attachmentUrl: cloudinaryUrl().optional(),
    attachmentType: z.enum(["image", "file"]).optional(),
    attachmentName: z.string().max(120).optional(),
    attachmentSize: z.number().int().min(0).max(20 * 1024 * 1024).optional(),
  })
  // لازم الرسالة يكون فيها حاجة: نص أو كود أو مرفق
  .refine((m) => m.body.trim().length > 0 || m.codeContent || m.attachmentUrl, {
    message: "Empty message",
  });

// presence: عدد اتصالات كل مستخدم (ممكن يكون فاتح من موبايل ولابتوب)
const onlineCounts = new Map<string, number>();
export const isOnline = (userId: string) => (onlineCounts.get(userId) ?? 0) > 0;

// مرجع للـ io instance — عشان REST routes (مش بس socket handlers) تقدر
// تبعت أحداث real-time للمستخدم، زي إشعار لايك أو كومنت جديد
let ioRef: Server | null = null;
export function emitToUser(userId: string, event: string, payload: unknown) {
  ioRef?.to(`user:${userId}`).emit(event, payload);
}

// ---------------------------------------------------------------
// [SECURITY BUG-10] البث لازم يحترم نفس قواعد الرؤية بتاعة الـ REST
//
// الاتنين دول كانوا بيستخدموا io.emit — يعني بيروحوا لكل المتصلين على السيرفر.
// النتيجة إن أي حد فاتح التطبيق كان بيستقبل تحديثات بوستات الكوميونتيهات
// الخاصة اللي مش عضو فيها (الـ id وعدّادات التفاعل). ده بالظبط الضمان اللي
// BUG-02 اتصلّح عشانه في الـ REST، بس كان بيتسرّب من طبقة الـ real-time.
//
// الدوال دي fire-and-forget بشكل مقصود: البث ميزة تحسينية، لو فشل مايبوظش
// الطلب الأصلي — بس بنلوج الخطأ عشان مايضيعش بصمت.
// ---------------------------------------------------------------

/**
 * بث تحديث بوست (عدد لايكات/كومنتات/ريبوستات) للجمهور المسموح له يشوف البوست.
 *
 * @param communityId كوميونتي البوست، أو null لو بوست عادي في الفيد.
 *   الباراميتر ده **إلزامي** عن قصد: أي call site جديد لازم يقرر الجمهور
 *   صراحة بدل ما ينسى ويبث للكل.
 */
export function broadcastPostUpdate(
  postId: string,
  patch: Record<string, unknown>,
  communityId: string | null
) {
  void emitPostUpdate(postId, patch, communityId).catch((e) =>
    console.error("[broadcastPostUpdate]", e)
  );
}

async function emitPostUpdate(postId: string, patch: Record<string, unknown>, communityId: string | null) {
  const payload = { postId, ...patch };

  // بوست في الفيد العام → مرئي لأي حد مسجّل دخول، فالبث للكل صح (ومن غير أي query)
  if (!communityId) {
    ioRef?.emit("post:update", payload);
    return;
  }

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { isPrivate: true, members: { select: { userId: true } } },
  });
  if (!community) return;

  // كوميونتي عام → أي حد يقدر يقرا بوستاته (نفس منطق communityVisibility)
  if (!community.isPrivate) {
    ioRef?.emit("post:update", payload);
    return;
  }

  // كوميونتي خاص → الأعضاء بس. .to() بياخد أراي رومات وبيعمل dedupe لوحده،
  // فالمستخدم المتصل من أكتر من جهاز بيوصله الحدث مرة واحدة.
  const rooms = community.members.map((m) => `user:${m.userId}`);
  if (rooms.length) ioRef?.to(rooms).emit("post:update", payload);
}

/**
 * بث تحديث بروفايل (عدد المتابعين) لكل المتصلين ما عدا اللي بينهم وبين صاحب
 * البروفايل حظر.
 *
 * @param profileOwnerId صاحب البروفايل — لازم عشان نعرف نستثني المحظورين.
 */
export function broadcastProfileUpdate(
  username: string,
  patch: Record<string, unknown>,
  profileOwnerId: string
) {
  void emitProfileUpdate(username, patch, profileOwnerId).catch((e) =>
    console.error("[broadcastProfileUpdate]", e)
  );
}

async function emitProfileUpdate(username: string, patch: Record<string, unknown>, profileOwnerId: string) {
  // [SECURITY BUG-04] اللي بينهم حظر مايشوفوش بعض: GET /api/profiles/:username
  // بيرجّع 404 للمحظور. من غير الاستثناء ده كان هيستقبل نفس عدد المتابعين
  // لحظيًا من السوكيت — نفس البيانات اللي المفروض متحجوبة عنه.
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: profileOwnerId }, { blockedId: profileOwnerId }] },
    select: { blockerId: true, blockedId: true },
  });

  const excluded = blocks.map((b) => (b.blockerId === profileOwnerId ? b.blockedId : b.blockerId));
  const payload = { username, ...patch };

  if (!excluded.length) {
    ioRef?.emit("profile:update", payload);
    return;
  }
  ioRef?.except(excluded.map((id) => `user:${id}`)).emit("profile:update", payload);
}

export function setupSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: getAllowedOrigins() },
  });
  ioRef = io;

  // auth middleware: نفس JWT بتاع الـ REST — من غير توكن صالح مفيش اتصال
  // [SECURITY BUG-05] بنتأكد كمان إن tokenVersion لسه مطابق للداتابيز،
  // فالتوكن اللي اتبطّل بعد reset الباسورد مايقدرش يفتح socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("UNAUTHORIZED"));
      const payload = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { tokenVersion: true },
      });
      if (!user || user.tokenVersion !== (payload.tokenVersion ?? 0)) {
        return next(new Error("UNAUTHORIZED"));
      }
      socket.data.user = payload satisfies TokenPayload;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const { userId } = socket.data.user as TokenPayload;

    socket.join(`user:${userId}`);
    onlineCounts.set(userId, (onlineCounts.get(userId) ?? 0) + 1);
    io.emit("presence:update", { userId, online: true });

    // ---- إرسال رسالة ----
    socket.on("message:send", async (payload, ack) => {
      try {
        const input = sendMessageSchema.parse(payload);

        // أمان: المرسل لازم يكون طرف في المحادثة
        const membership = await prisma.conversationParticipant.findUnique({
          where: {
            conversationId_userId: { conversationId: input.conversationId, userId },
          },
        });
        if (!membership) return ack?.({ ok: false, error: "FORBIDDEN" });

        const message = await prisma.message.create({
          data: {
            conversationId: input.conversationId,
            senderId: userId,
            body: input.body,
            codeLanguage: input.codeLanguage ?? null,
            codeContent: input.codeContent ?? null,
            attachmentUrl: input.attachmentUrl ?? null,
            attachmentType: input.attachmentUrl ? input.attachmentType ?? "file" : null,
            attachmentName: input.attachmentUrl ? input.attachmentName ?? null : null,
            attachmentSize: input.attachmentUrl ? input.attachmentSize ?? null : null,
          },
          select: {
            id: true,
            conversationId: true,
            senderId: true,
            body: true,
            codeLanguage: true,
            codeContent: true,
            attachmentUrl: true,
            attachmentType: true,
            attachmentName: true,
            attachmentSize: true,
            createdAt: true,
            sender: {
              select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } },
            },
          },
        });

        // نحدّث updatedAt عشان المحادثة تطلع فوق في القايمة
        await prisma.conversation.update({
          where: { id: input.conversationId },
          data: { updatedAt: new Date() },
        });

        // نبعت لكل أطراف المحادثة (بما فيهم أجهزة المرسل التانية)
        const participants = await prisma.conversationParticipant.findMany({
          where: { conversationId: input.conversationId },
          select: { userId: true },
        });
        for (const p of participants) {
          io.to(`user:${p.userId}`).emit("message:new", message);
        }

        // إشعار إيميل للأطراف اللي مش online (غير المرسِل نفسه)
        // بيشتغل بس لو SMTP متظبط — غير كده الدالة بتتجاهل بهدوء
        notifyOfflineRecipients(participants, userId, message).catch((e) =>
          console.error("[offline email]", e)
        );

        ack?.({ ok: true, message });
      } catch (err) {
        // الـ socket handlers برضه ليها error handling — مفيش crash
        console.error("[socket message:send]", err);
        ack?.({ ok: false, error: "INVALID_MESSAGE" });
      }
    });

    // ---- typing indicator: مجرد passthrough، مش بيتخزن ----
    socket.on("typing", async (payload: { conversationId: string; typing: boolean }) => {
      if (typeof payload?.conversationId !== "string") return;

      // [SECURITY] نفس فحص message:send — من غيره أي مستخدم يقدر يبعت
      // typing مزيف لأي محادثة مش طرف فيها (انتحال + probing لمعرفات المحادثات)
      const membership = await prisma.conversationParticipant.findUnique({
        where: {
          conversationId_userId: { conversationId: payload.conversationId, userId },
        },
      });
      if (!membership) return;

      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: payload.conversationId },
        select: { userId: true },
      });
      for (const p of participants) {
        if (p.userId !== userId) {
          io.to(`user:${p.userId}`).emit("typing", {
            conversationId: payload.conversationId,
            userId,
            typing: !!payload.typing,
          });
        }
      }
    });

    // ---- استعلام presence لمستخدمين معينين ----
    socket.on("presence:query", (userIds: string[], ack) => {
      if (!Array.isArray(userIds)) return;
      ack?.(Object.fromEntries(userIds.map((id) => [id, isOnline(id)])));
    });

    socket.on("disconnect", () => {
      const remaining = (onlineCounts.get(userId) ?? 1) - 1;
      if (remaining <= 0) {
        onlineCounts.delete(userId);
        io.emit("presence:update", { userId, online: false });
      } else {
        onlineCounts.set(userId, remaining);
      }
    });
  });

  return io;
}

// ---------------------------------------------------------------
// إشعار إيميل للأطراف اللي مش متصلين دلوقتي
// عشان ما يفوتهمش إن حد بعتلهم رسالة وهم offline
// ---------------------------------------------------------------
import { sendEmail } from "./lib/email.js";

async function notifyOfflineRecipients(
  participants: { userId: string }[],
  senderId: string,
  message: { body: string; codeContent?: string | null }
) {
  // المستقبِلين اللي مش online ومش المرسِل نفسه
  const offlineIds = participants
    .map((p) => p.userId)
    .filter((id) => id !== senderId && !isOnline(id));

  if (offlineIds.length === 0) return;

  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: { username: true, profile: { select: { displayName: true } } },
  });
  const senderName = sender?.profile?.displayName ?? sender?.username ?? "Someone";

  const recipients = await prisma.user.findMany({
    where: { id: { in: offlineIds } },
    select: { email: true, profile: { select: { displayName: true } } },
  });

  // [SECURITY] الاسم ونص الرسالة من إدخال المستخدم وبيتحقنوا في HTML الإيميل
  // من غير escaping ممكن حقن روابط/محتوى تصيّد في إيميل رسمي من DevConnect
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const safeSenderName = esc(senderName);
  const preview = message.codeContent
    ? "sent you a code snippet"
    : message.body.trim()
      ? `: "${esc(message.body.slice(0, 80))}"`
      : "sent you an attachment";
  // نفس مصدر الـ origins بتاع باقي المشروع — قبل كده كان بيقرأ CLIENT_URL
  // مباشرة وبيرجّع "" لو مش موجود، فرابط "Open DevConnect" في الإيميل كان
  // بيطلع مكسور (href="/messages") من غير ما حد ياخد باله
  const clientUrl = getAllowedOrigins()[0];

  for (const r of recipients) {
    await sendEmail(
      r.email,
      // [SECURITY BUG-08] الاسم الخام مقصود هنا مش safeSenderName: الـ subject
      // نص عادي مش HTML، فتهريب HTML كان هيخلي المستخدم يشوف "&amp;" حرفيًا
      // في عنوان الإيميل. الخطر الحقيقي في الـ subject هو CR/LF (حقن headers)
      // وده بيتعقّم جوه sendEmail نفسها لكل الإيميلات.
      `${senderName} messaged you on DevConnect`,
      `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #6C5CE7;">⌁ DevConnect</h2>
          <p><b>${safeSenderName}</b> ${preview}</p>
          <a href="${clientUrl}/messages"
             style="display:inline-block; background:#6C5CE7; color:#fff; padding:12px 24px;
                    border-radius:8px; text-decoration:none; font-weight:bold; margin:16px 0;">
            Open DevConnect
          </a>
          <p style="color:#888; font-size:13px;">You're getting this because you were offline when the message arrived.</p>
        </div>
      `
    ).catch(() => {}); // فشل إيميل واحد ما يوقفش الباقي
  }
}

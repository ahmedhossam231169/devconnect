import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { verifyToken, type TokenPayload } from "./lib/jwt.js";
import { prisma } from "./lib/prisma.js";
import { getAllowedOrigins } from "./lib/cors.js";

// ---------------------------------------------------------------
// طبقة الـ real-time — Socket.io
// كل مستخدم متصل بينضم لروم باسمه user:{id}
// فإرسال رسالة = emit للروم بتاع الطرف التاني (كل أجهزته توصلها)
// ---------------------------------------------------------------

const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().min(1).max(5000),
  codeLanguage: z.string().max(20).optional(),
  codeContent: z.string().max(10_000).optional(),
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

export function setupSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: getAllowedOrigins() },
  });
  ioRef = io;

  // auth middleware: نفس JWT بتاع الـ REST — من غير توكن صالح مفيش اتصال
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("UNAUTHORIZED"));
      socket.data.user = verifyToken(token) satisfies TokenPayload;
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
          },
          select: {
            id: true,
            conversationId: true,
            senderId: true,
            body: true,
            codeLanguage: true,
            codeContent: true,
            createdAt: true,
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

  const preview = message.codeContent ? "sent you a code snippet" : `: "${message.body.slice(0, 80)}"`;
  const clientUrl = (process.env.CLIENT_URL || "").split(",")[0] || "";

  for (const r of recipients) {
    await sendEmail(
      r.email,
      `${senderName} messaged you on DevConnect`,
      `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #6C5CE7;">⌁ DevConnect</h2>
          <p><b>${senderName}</b> ${preview}</p>
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

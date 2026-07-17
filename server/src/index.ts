// ⚠️ config لازم يكون أول import — بيحمّل الـ .env وبيتحقق من كل المتغيرات،
// وبيوقف السيرفر فورًا لو في حاجة ناقصة أو غلط. أي import بيقرأ env لازم ييجي بعده.
import { config } from "./lib/config.js";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler, notFoundHandler, asyncHandler } from "./middleware/errorHandler.js";
import { Errors } from "./lib/errors.js";
import { authRouter } from "./routes/auth.js";
import { postsRouter } from "./routes/posts.js";
import { conversationsRouter } from "./routes/conversations.js";
import { profilesRouter } from "./routes/profiles.js";
import { talentRouter } from "./routes/talent.js";
import { communitiesRouter } from "./routes/communities.js";
import { notificationsRouter } from "./routes/notifications.js";
import { friendsRouter } from "./routes/friends.js";
import { moderationRouter } from "./routes/moderation.js";
import { adminRouter } from "./routes/admin.js";
import { shortlistRouter } from "./routes/shortlist.js";
import { searchRouter } from "./routes/search.js";
import { feedRouter } from "./routes/feed.js";
import { jobsRouter } from "./routes/jobs.js";
import { setupSocket } from "./socket.js";
import { getAllowedOrigins } from "./lib/cors.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { healthRouter, markShuttingDown } from "./routes/health.js";
import { prisma } from "./lib/prisma.js";

const app = express();
const PORT = config.PORT;

// معظم منصات الاستضافة (Railway, Render, Vercel...) بتحط السيرفر ورا reverse proxy
// من غير السطر ده، Express هياخد IP الـ proxy بدل IP المستخدم الحقيقي.
// [SECURITY BUG-06] القيمة بقت من الإعدادات مش ثابتة على 1: "trust proxy: 1"
// معناها ثقة عمياء في أول X-Forwarded-For. لو التطبيق اتعرض من غير بروكسي
// واحد بالظبط قدامه، أي حد يبعت الهيدر ده بقيم متغيرة يبقى "IP جديد" كل مرة
// ويعدّي الـ rate limiting بالكامل (brute force على الباسوردات).
// اضبط TRUST_PROXY حسب البنية الفعلية — شوف .env.example.
app.set("trust proxy", config.TRUST_PROXY);

// ---------- Global middleware ----------
app.use(helmet());
app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

// ---------- Routes ----------
// ⚠️ قبل apiLimiter عن قصد: الـ load balancer بيسأل كل ثواني، فلو الفحوصات
// اتحسبت في حد الـ 300/15 دقيقة كانت هتاخد 429 والـ LB هيشيل السيرفر من
// الخدمة وهو سليم تمامًا. (شوف routes/health.ts)
app.use("/api", healthRouter);

// [SECURITY] endpoint تجريبي — بيشتغل في التطوير بس، مالوش لازمة في الإنتاج
if (!config.isProd) {
  app.get(
    "/api/demo-error",
    asyncHandler(async () => {
      throw Errors.notFound("Demo resource");
    })
  );
}

app.use("/api", apiLimiter);
app.use("/api/auth", authRouter);
app.use("/api/posts", postsRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/talent", talentRouter);
app.use("/api/communities", communitiesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/moderation", moderationRouter);
app.use("/api/admin", adminRouter);
app.use("/api/shortlist", shortlistRouter);
app.use("/api/search", searchRouter);
app.use("/api/feed", feedRouter);
app.use("/api/jobs", jobsRouter);

// ---------- Error handling (لازم يفضلوا آخر حاجة) ----------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------- HTTP + WebSocket على نفس البورت ----------
const httpServer = createServer(app);
const io = setupSocket(httpServer);

// ---------- مهلات الطلبات ----------
// من غيرها اتصال بطيء يقدر يمسك socket مفتوح للأبد (slowloris): المهاجم بيفتح
// اتصالات كتير وبيبعت هيدرز ببطء شديد، فبيستهلك كل الاتصالات المتاحة.
// القيم فوق نافذة الـ long-polling بتاعة socket.io (pingInterval 25 ثانية)
// عن قصد — أقل من كده كنا هنقطع الـ polling transport للمتصفحات اللي
// مابتستخدمش websocket.
httpServer.headersTimeout = 30_000;
httpServer.requestTimeout = 60_000;
// لازم تكون أطول من الـ keepalive بتاع الـ reverse proxy اللي قدامنا، وإلا
// السيرفر بيقفل الاتصال في نفس اللحظة اللي البروكسي بيبعت فيها طلب جديد
// عليه → 502 عشوائية. nginx الافتراضي 75 ثانية.
httpServer.keepAliveTimeout = 80_000;

httpServer.listen(PORT, () => {
  console.log(`🚀 DevConnect API + WebSocket running on http://localhost:${PORT}`);
});

// ---------- الإغلاق الآمن ----------
// من غير ده كل deploy بيقتل الطلبات اللي في النص واتصالات السوكيت فجأة —
// المستخدم بيشوف خطأ عشوائي، والرسالة اللي كان بيبعتها بتضيع.
// الترتيب مهم: نفشّل الـ readiness الأول عشان الـ LB يوقف الترافيك الجديد،
// وبعدين نصرّف اللي شغال.
/**
 * مهلة عشان الـ load balancer يلاحظ إن readiness بقت 503 ويشيلنا من التوجيه
 * قبل ما نقفل فعلاً. من غيرها بنقفل في نفس اللحظة اللي لسه بيبعتلنا فيها
 * طلبات → المستخدم بياخد 502.
 */
const DRAIN_DELAY_MS = 3_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return; // SIGTERM مرتين مايبدأش عمليتين إغلاق
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — draining`);

  // 1) readiness تفشل فورًا → الـ LB يوقف توجيه طلبات جديدة علينا
  markShuttingDown();

  // 2) لو التصريف علّق لأي سبب، لازم نخرج بالعافية — غير كده الـ orchestrator
  //    هيعمل SIGKILL وهو ده بالظبط اللي بنحاول نتجنبه
  const forceExit = setTimeout(() => {
    console.error("[shutdown] drain timed out — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref(); // ما يمنعش الخروج الطبيعي لو خلصنا بدري

  try {
    // 3) استنى الـ LB ياخد باله من الـ 503 قبل ما نقفل الباب
    await new Promise((r) => setTimeout(r, DRAIN_DELAY_MS));

    // 4) io.close() بيفصل كل الكلاينتات **وبيقفل السيرفر اللي تحتيه كمان**
    //    وبيستنى الطلبات الشغالة تخلص. فمابنناديش httpServer.close() بعديها:
    //    السيرفر بيبقى اتقفل خلاص وبترمي ERR_SERVER_NOT_RUNNING → خروج بكود 1
    //    وكأن التطبيق وقع، مع إن التصريف تمام. (اتكشفت في shutdown.spec.ts)
    await new Promise<void>((resolve, reject) => io.close((err) => (err ? reject(err) : resolve())));

    // 5) اقفل الداتابيز في الآخر — الطلبات اللي كانت بتخلص كانت محتاجاها
    await prisma.$disconnect();
    console.log("[shutdown] clean");
    process.exit(0);
  } catch (err) {
    console.error("[shutdown] error while draining", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM")); // اللي الـ orchestrator بيبعته
process.on("SIGINT", () => void shutdown("SIGINT")); // Ctrl+C محليًا

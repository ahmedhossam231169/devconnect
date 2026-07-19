// ⚠️ config لازم يكون أول import — بيحمّل الـ .env وبيتحقق من كل المتغيرات،
// وبيوقف السيرفر فورًا لو في حاجة ناقصة أو غلط. أي import بيقرأ env لازم ييجي بعده.
import { config } from "./lib/config.js";
import { createServer } from "node:http";
import { app } from "./app.js";
import { setupSocket } from "./socket.js";
import { markShuttingDown } from "./routes/health.js";
import { prisma } from "./lib/prisma.js";
import { pruneExpiredRefreshTokens } from "./lib/refreshTokens.js";

// ---------------------------------------------------------------
// إقلاع السيرفر. بناء الـ app نفسه في app.ts — الفصل ده عشان الاختبارات
// تقدر تستورد الـ app من غير ما تفتح بورت.
// ---------------------------------------------------------------
const PORT = config.PORT;
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

  // كل تجديد بيسيب وراه صف محروق، فجدول RefreshToken بيكبر للأبد من غير
  // التنضيف ده. بيتعمل وقت التشغيل مش على تايمر: بنعمل deploy كل كام يوم،
  // والصفوف الميتة مالهاش أي أثر غير المساحة — مش محتاجة أدق من كده، ولا
  // محتاجة cron يتظبط ويتنسى.
  pruneExpiredRefreshTokens()
    .then((n) => n > 0 && console.log(`🧹 pruned ${n} dead refresh token(s)`))
    .catch((err) => console.error("refresh token prune failed (not fatal):", err));
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

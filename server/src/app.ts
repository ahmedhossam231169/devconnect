// ⚠️ config لازم يكون أول import — بيحمّل الـ .env وبيتحقق من كل المتغيرات،
// وبيوقف السيرفر فورًا لو في حاجة ناقصة أو غلط. أي import بيقرأ env لازم ييجي بعده.
import { config } from "./lib/config.js";

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

import { getAllowedOrigins } from "./lib/cors.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { healthRouter, markShuttingDown } from "./routes/health.js";
import { prisma } from "./lib/prisma.js";
import { pruneExpiredRefreshTokens } from "./lib/refreshTokens.js";

const app = express();


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

// [SECURITY] كل ردود الـ API مش قابلة للتخزين.
// من غير توجيه صريح المتصفح بيطبّق "heuristic caching" على ردود GET —
// يعني رد زي /api/auth/me (إيميل واسم وبروفايل) ممكن يتكتب على القرص
// ويتقرا بعد تسجيل الخروج، أو من مستخدم تاني على نفس الجهاز، أو يتخزن
// في أي proxy وسيط. مفيش رد هنا عام أو ثابت، فـ no-store هو الصح للكل.
// (بيتحط قبل الـ routes عشان يشمل الـ health كمان — فحص صحة مخزَّن مالوش معنى.)
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

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

// بنصدّر الـ app من غير ما نشغّل سيرفر. ده اللي بيخلي الاختبارات تركّبه
// جوه العملية نفسها (supertest) بدل ما تحتاج سيرفر شغال على بورت ثابت —
// وهو السبب اللي كان مانع الاختبارات القديمة إنها تشتغل في CI.
// الإقلاع الفعلي (listen + socket + الإغلاق الآمن) في index.ts.
export { app };

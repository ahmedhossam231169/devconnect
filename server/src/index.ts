import "dotenv/config";
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
import { pagesRouter } from "./routes/pages.js";
import { shortlistRouter } from "./routes/shortlist.js";
import { searchRouter } from "./routes/search.js";
import { feedRouter } from "./routes/feed.js";
import { jobsRouter } from "./routes/jobs.js";
import { setupSocket } from "./socket.js";
import { getAllowedOrigins } from "./lib/cors.js";
import { apiLimiter } from "./middleware/rateLimit.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// معظم منصات الاستضافة (Railway, Render, Vercel...) بتحط السيرفر ورا reverse proxy
// من غير السطر ده، Express هياخد IP الـ proxy بدل IP المستخدم الحقيقي
app.set("trust proxy", 1);

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
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "devconnect-api", time: new Date().toISOString() });
});

// [SECURITY] endpoint تجريبي — بيشتغل في التطوير بس، مالوش لازمة في الإنتاج
if (process.env.NODE_ENV !== "production") {
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
app.use("/api/pages", pagesRouter);
app.use("/api/shortlist", shortlistRouter);
app.use("/api/search", searchRouter);
app.use("/api/feed", feedRouter);
app.use("/api/jobs", jobsRouter);

// ---------- Error handling (لازم يفضلوا آخر حاجة) ----------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------- HTTP + WebSocket على نفس البورت ----------
const httpServer = createServer(app);
setupSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`🚀 DevConnect API + WebSocket running on http://localhost:${PORT}`);
});

// [SECURITY BUG-10] البث اللحظي لازم يحترم نفس قواعد الرؤية بتاعة الـ REST.
//
// قبل الإصلاح: broadcastPostUpdate/broadcastProfileUpdate كانوا بيستخدموا
// io.emit — يعني الحدث بيروح لكل متصل على السيرفر. النتيجة إن أي حد فاتح
// التطبيق كان بيستقبل تحديثات بوستات الكوميونتيهات الخاصة اللي مش عضو فيها.
//
// شغّله بـ (لازم السيرفر شغال على :4000 بـ TRUST_PROXY=1، وداتابيز تجريبية):
//   TRUST_PROXY=1 npx tsx src/index.ts      # terminal 1
//   npx tsx src/tests/socket-broadcast.spec.ts
//
// ليه TRUST_PROXY=1: الـ authLimiter بيسمح بـ 10 طلبات auth كل 15 دقيقة لكل IP.
// السويت بتسجّل 3 يوزرس، يعني بعد ٣ تشغيلات ورا بعض من نفس الـ IP كانت بتاخد
// 429 وتموت — وده اللي بيخلي سويتات الأمان تتعطّل من غير ما حد ياخد باله.
// كل تشغيلة دلوقتي بتتقمّص IP فريد عن طريق X-Forwarded-For، فبتفضل قابلة
// لإعادة التشغيل. (نفس أسلوب login-throttle.spec.)
//
// اصطلاح النتائج:
//   ✓ PASS = التطبيق تصرّف صح (آمن)
//   ✗ VULN = تسريب مؤكد
//   ✗ FAIL = التست نفسه ما اشتغلش زي المتوقع
import { io as ioc, type Socket } from "socket.io-client";

const B = "http://localhost:4000";
const TAG = Date.now().toString(36);

// IP فريد لكل تشغيلة (نطاق TEST-NET-3 المخصص للتوثيق) — عشان الـ authLimiter
// اللي بيتعد على الـ IP ما يخليش السويت غير قابلة لإعادة التشغيل
const RUN_IP = `203.0.113.${Math.floor(Math.random() * 254)}`;

async function req(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(B + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": RUN_IP,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* بعض الردود مفيهاش body */ }
  return { status: res.status, data };
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioc(B, { auth: { token }, transports: ["websocket"] });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (e) => reject(e));
    setTimeout(() => reject(new Error("socket connect timeout")), 4000);
  });
}

const results = { pass: 0, vuln: 0, fail: 0 };
function check(label: string, verdict: "PASS" | "VULN" | "FAIL", detail = "") {
  const mark = verdict === "PASS" ? "✓ PASS" : verdict === "VULN" ? "✗ VULN" : "✗ FAIL";
  results[verdict === "PASS" ? "pass" : verdict === "VULN" ? "vuln" : "fail"]++;
  console.log(`  ${mark}  ${label}${detail ? "  →  " + detail : ""}`);
}

// التسجيل مقصور على @devconnect.com، والـ DEVELOPER لازم resumeUrl بامتداد .pdf
async function register(handle: string) {
  const username = `${handle}_${TAG}`;
  const r = await req("POST", "/api/auth/register", undefined, {
    email: `${username}@devconnect.com`,
    username,
    password: "supersecret1",
    displayName: handle,
    yearsExperience: 3,
    resumeUrl: "https://res.cloudinary.com/demo/raw/upload/cv.pdf",
  });
  if (r.status !== 201) throw new Error(`register ${handle} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token as string, username, id: r.data.user.id as string };
}

/** بيجمّع كل أحداث event اللي توصل للسوكيت ده */
function collect(socket: Socket, event: string): any[] {
  const seen: any[] = [];
  socket.on(event, (p) => seen.push(p));
  return seen;
}

const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n=== Socket broadcast scoping (BUG-10) — run ${TAG} ===\n`);

  const owner = await register("owner");
  const outsider = await register("outsider");
  console.log("setup: registered owner + outsider\n");

  // owner بيعمل كوميونتي خاص وبينشر فيه بوست
  const community = await req("POST", "/api/communities", owner.token, {
    name: `Private Guild ${TAG}`,
    category: "Backend",
    isPrivate: true,
  });
  if (community.status !== 201) throw new Error(`community create failed: ${community.status} ${JSON.stringify(community.data)}`);
  const slug = community.data.community.slug;

  const privatePost = await req("POST", `/api/communities/${slug}/posts`, owner.token, {
    type: "TEXT",
    body: "secret internal discussion",
  });
  if (privatePost.status !== 201) throw new Error(`private post failed: ${privatePost.status} ${JSON.stringify(privatePost.data)}`);
  const privatePostId = privatePost.data.post.id;

  // بوست عادي في الفيد — ضابط التحكم: ده المفروض يوصل للكل
  const publicPost = await req("POST", "/api/posts", owner.token, { type: "TEXT", body: "hello world" });
  const publicPostId = publicPost.data.post.id;

  // تأكيد إن الـ REST فعلاً بيحجب البوست الخاص عن الغريب (BUG-02 لسه شغال)
  const outsiderRead = await req("GET", `/api/posts/${privatePostId}`, outsider.token);
  check("REST: outsider cannot read the private-community post", outsiderRead.status === 404 ? "PASS" : "VULN", `status ${outsiderRead.status}`);

  const ownerSock = await connect(owner.token);
  const outsiderSock = await connect(outsider.token);
  const ownerEvents = collect(ownerSock, "post:update");
  const outsiderEvents = collect(outsiderSock, "post:update");
  await settle(300);

  // ---- الحدث: owner بيعمل لايك على بوست الكوميونتي الخاص ----
  await req("POST", `/api/posts/${privatePostId}/like`, owner.token);
  await settle();

  const ownerGotPrivate = ownerEvents.some((e) => e.postId === privatePostId);
  const outsiderGotPrivate = outsiderEvents.some((e) => e.postId === privatePostId);

  check("member receives post:update for the private post", ownerGotPrivate ? "PASS" : "FAIL", ownerGotPrivate ? "" : "member got nothing — broadcast may be over-scoped");
  check(
    "outsider does NOT receive post:update for the private post",
    outsiderGotPrivate ? "VULN" : "PASS",
    outsiderGotPrivate ? `leaked: ${JSON.stringify(outsiderEvents.find((e) => e.postId === privatePostId))}` : "no leak"
  );

  // ---- ضابط التحكم: البوست العام لازم يوصل للاتنين ----
  await req("POST", `/api/posts/${publicPostId}/like`, owner.token);
  await settle();

  check("control: outsider DOES receive post:update for a public post", outsiderEvents.some((e) => e.postId === publicPostId) ? "PASS" : "FAIL");
  check("control: member DOES receive post:update for a public post", ownerEvents.some((e) => e.postId === publicPostId) ? "PASS" : "FAIL");

  // ---- profile:update لازم يستثني المحظورين (BUG-04) ----
  const profileEvents = collect(outsiderSock, "profile:update");
  await req("POST", `/api/moderation/block/${outsider.username}`, owner.token); // owner بيحظر outsider
  await settle(300);

  // طرف تالت بيتابع owner → لازم يتبث للكل ما عدا outsider المحظور
  const third = await register("third");
  const thirdSock = await connect(third.token);
  const thirdEvents = collect(thirdSock, "profile:update");
  await settle(300);

  await req("POST", `/api/friends/follow/${owner.username}`, third.token);
  await settle();

  check("control: non-blocked user receives profile:update", thirdEvents.some((e) => e.username === owner.username) ? "PASS" : "FAIL");
  check(
    "blocked user does NOT receive profile:update for the blocker",
    profileEvents.some((e) => e.username === owner.username) ? "VULN" : "PASS",
    profileEvents.some((e) => e.username === owner.username) ? "leaked follower count to a blocked user" : "no leak"
  );

  ownerSock.close(); outsiderSock.close(); thirdSock.close();

  console.log(`\n--- ${results.pass} pass · ${results.vuln} vuln · ${results.fail} fail ---\n`);
  process.exit(results.vuln + results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("\nSUITE ERROR:", e); process.exit(1); });

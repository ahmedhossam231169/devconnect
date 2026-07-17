// سطح المراجعة للمشرفين (/api/admin) — قبل كده البلاغات كانت بتتكتب وخلاص:
// مفيش status، مفيش مراجع، ومفيش أي endpoint يقراها. الملف ده بيتحقق إن
// الطابور شغال وإن الحماية بتاعته مش قابلة للتخطي.
//
// شغّله بـ (لازم السيرفر شغال على :4000، وداتابيز تجريبية):
//   TRUST_PROXY=1 npx tsx src/index.ts      # terminal 1
//   npx tsx src/tests/admin.spec.ts
//
// اصطلاح النتائج:
//   ✓ PASS = التطبيق تصرّف صح (آمن)
//   ✗ VULN = خرق مؤكد في الصلاحيات
//   ✗ FAIL = التست نفسه ما اشتغلش زي المتوقع
import { prisma } from "../lib/prisma.js";

const B = "http://localhost:4000";
const TAG = Date.now().toString(36);
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

const setAdmin = (id: string, isAdmin: boolean) =>
  prisma.user.update({ where: { id }, data: { isAdmin } });

const results = { pass: 0, vuln: 0, fail: 0 };
function check(label: string, verdict: "PASS" | "VULN" | "FAIL", detail = "") {
  const mark = verdict === "PASS" ? "✓ PASS" : verdict === "VULN" ? "✗ VULN" : "✗ FAIL";
  results[verdict === "PASS" ? "pass" : verdict === "VULN" ? "vuln" : "fail"]++;
  console.log(`  ${mark}  ${label}${detail ? "  →  " + detail : ""}`);
}

async function main() {
  console.log(`\n=== Admin review surface — run ${TAG} ===\n`);

  const mod = await register("mod");
  const author = await register("author");
  const reporter = await register("reporter");
  console.log("setup: registered mod + author + reporter\n");

  const post = await req("POST", "/api/posts", author.token, { type: "TEXT", body: "spammy content here" });
  if (post.status !== 201) throw new Error(`post create failed: ${post.status}`);
  const postId = post.data.post.id;

  const filed = await req("POST", "/api/moderation/report", reporter.token, {
    postId,
    reason: "This looks like spam",
  });
  check("report can still be filed", filed.status === 201 ? "PASS" : "FAIL", `status ${filed.status}`);

  // الـ id بنجيبه من الداتابيز مش من الرد: POST /report بيرجّع رسالة بس (عن قصد —
  // المبلّغ مالوش دعوة بمعرّف البلاغ). ولازم يكون id حقيقي: لو استخدمنا id
  // مخترع، الـ 404 اللي هترجع هتبقى بسبب "البلاغ مش موجود" مش بسبب الجارد،
  // والتست هينجح حتى والحماية مقفولة.
  const reportRow = await prisma.report.findFirst({
    where: { targetPostId: postId },
    select: { id: true },
  });
  if (!reportRow) throw new Error("filed report not found in DB");
  const reportId = reportRow.id;

  // --- الصلاحيات -------------------------------------------------
  console.log("\n[ access control ]");

  const anon = await req("GET", "/api/admin/reports");
  check("anonymous → rejected", anon.status === 401 ? "PASS" : "VULN", `status ${anon.status}`);

  const asUser = await req("GET", "/api/admin/reports", reporter.token);
  check(
    "non-admin → 404 (مش 403: 403 بتأكد إن المسار موجود)",
    asUser.status === 404 ? "PASS" : asUser.status === 403 ? "FAIL" : "VULN",
    `status ${asUser.status}`
  );

  const writeAsUser = await req("PATCH", `/api/admin/reports/${reportId}`, reporter.token, {
    status: "DISMISSED",
  });
  check("non-admin can't close reports", writeAsUser.status === 404 ? "PASS" : "VULN", `status ${writeAsUser.status}`);

  // --- الطابور ---------------------------------------------------
  console.log("\n[ queue ]");

  await setAdmin(mod.id, true);

  // نفس التوكن القديم بالظبط — الصلاحية بتتقرا من الداتابيز، فالمفروض تسري
  // على طول من غير ما اليوزر يعمل login تاني
  const list = await req("GET", "/api/admin/reports?status=PENDING", mod.token);
  check("admin sees the queue on the same token", list.status === 200 ? "PASS" : "FAIL", `status ${list.status}`);

  const mine = list.data?.reports?.find((r: any) => r.target?.id === postId);
  check("filed report appears in PENDING", mine ? "PASS" : "FAIL");
  check("target post is hydrated", mine?.target?.excerpt?.includes("spammy") ? "PASS" : "FAIL", mine?.target?.excerpt ?? "—");
  check("reporter is named", mine?.reporter?.username === reporter.username ? "PASS" : "FAIL", mine?.reporter?.username ?? "—");

  const stats = await req("GET", "/api/admin/reports/stats", mod.token);
  check(
    "stats route isn't swallowed by /reports/:id",
    stats.status === 200 && stats.data?.stats ? "PASS" : "FAIL",
    JSON.stringify(stats.data?.stats ?? stats.status)
  );

  // --- المراجعة --------------------------------------------------
  console.log("\n[ review ]");

  const one = await req("GET", `/api/admin/reports/${mine.id}`, mod.token);
  check("single report returns full body", one.data?.report?.fullBody === "spammy content here" ? "PASS" : "FAIL");

  const resolved = await req("PATCH", `/api/admin/reports/${mine.id}`, mod.token, {
    status: "RESOLVED",
    resolutionNote: "removed, warned the author",
  });
  check("admin can resolve", resolved.status === 200 ? "PASS" : "FAIL", `status ${resolved.status}`);
  check("reviewer is stamped", resolved.data?.report?.reviewer === mod.username ? "PASS" : "FAIL", resolved.data?.report?.reviewer ?? "—");
  check("reviewedAt is set", resolved.data?.report?.reviewedAt ? "PASS" : "FAIL");

  const gone = await req("GET", "/api/admin/reports?status=PENDING", mod.token);
  check(
    "resolved report leaves the PENDING queue",
    gone.data?.reports?.some((r: any) => r.id === mine.id) ? "FAIL" : "PASS"
  );

  const reopened = await req("PATCH", `/api/admin/reports/${mine.id}`, mod.token, { status: "PENDING" });
  check(
    "reopening clears the reviewer",
    reopened.data?.report?.reviewer === null && reopened.data?.report?.reviewedAt === null ? "PASS" : "FAIL"
  );

  // --- هدف متمسوح ------------------------------------------------
  console.log("\n[ deleted target ]");

  await req("DELETE", `/api/posts/${postId}`, author.token);
  const afterDelete = await req("GET", `/api/admin/reports/${mine.id}`, mod.token);
  check(
    "report survives its post being deleted",
    afterDelete.status === 200 && afterDelete.data?.report?.target?.deleted === true ? "PASS" : "FAIL",
    `status ${afterDelete.status}`
  );

  // --- سحب الصلاحية ----------------------------------------------
  console.log("\n[ revocation ]");

  await setAdmin(mod.id, false);
  const afterRevoke = await req("GET", "/api/admin/reports", mod.token);
  check(
    "revoking admin takes effect on the same token (مفيش logout مطلوب)",
    afterRevoke.status === 404 ? "PASS" : "VULN",
    `status ${afterRevoke.status}`
  );

  console.log(`\n=== ${results.pass} pass · ${results.vuln} vuln · ${results.fail} fail ===\n`);
  // exitCode مش process.exit(): process.exit بيقتل العملية على طول وبيتخطى
  // الـ cleanup في الـ finally
  process.exitCode = results.vuln + results.fail > 0 ? 1 : 0;
}

// السويت بتدي صلاحية أدمن ليوزر اختباري. لو ماتت في النص (وده حصل فعلًا وقت
// كتابتها) كانت بتسيب حساب اختباري بصلاحية أدمن في الداتابيز. التنضيف هنا
// بيجري في كل الحالات — نجاح أو فشل أو كراش.
async function cleanup() {
  const { count } = await prisma.user.updateMany({
    where: { username: { endsWith: `_${TAG}` }, isAdmin: true },
    data: { isAdmin: false },
  });
  if (count) console.log(`cleanup: revoked admin from ${count} test user(s)`);
}

main()
  .catch((err) => {
    console.error("\n✗ suite crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e));
    await prisma.$disconnect();
  });

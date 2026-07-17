// [SECURITY BUG-08] الجلسات: access token قصير + refresh token قابل للإلغاء.
//
// قبل الإصلاح: JWT عمره 7–30 يوم في localStorage. مالوش إلغاء، فتوكن مسروق
// = دخول كامل لشهر، ومفيش تسجيل خروج حقيقي، ومفيش تطليع جهاز بعينه.
//
// شغّله بـ (لازم السيرفر شغال على :4000، وداتابيز تجريبية):
//   TRUST_PROXY=1 npx tsx src/index.ts      # terminal 1
//   npx tsx src/tests/refresh.spec.ts
//
// اصطلاح النتائج:
//   ✓ PASS = التطبيق تصرّف صح (آمن)
//   ✗ VULN = خرق مؤكد
//   ✗ FAIL = التست نفسه ما اشتغلش زي المتوقع
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";

const sha256 = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

const B = "http://localhost:4000";
const TAG = Date.now().toString(36);
const RUN_IP = `203.0.113.${Math.floor(Math.random() * 254)}`;
const REFRESH_COOKIE = "devconnect_refresh";

// fetch في node مابيديرش كوكيز، فبنمسكها بالإيد — وده كويس هنا: بيخلي
// التست يشوف الكوكي فعليًا بدل ما تتبعت من ورا ضهره
function readSetCookie(res: Response): string | null {
  const all = res.headers.getSetCookie?.() ?? [];
  const c = all.find((x) => x.startsWith(`${REFRESH_COOKIE}=`));
  if (!c) return null;
  return c.split(";")[0]!.slice(REFRESH_COOKIE.length + 1);
}

async function req(
  method: string,
  path: string,
  opts: { token?: string; cookie?: string | null; body?: unknown; csrf?: boolean } = {}
) {
  const res = await fetch(B + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": RUN_IP,
      ...(opts.csrf === false ? {} : { "X-Requested-With": "devconnect" }),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { Cookie: `${REFRESH_COOKIE}=${opts.cookie}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* redirects/no body */ }
  return { status: res.status, data, cookie: readSetCookie(res), raw: res };
}

async function register(handle: string) {
  const username = `${handle}_${TAG}`;
  const r = await req("POST", "/api/auth/register", {
    body: {
      email: `${username}@devconnect.com`,
      username,
      password: "supersecret1",
      displayName: handle,
      yearsExperience: 3,
      resumeUrl: "https://res.cloudinary.com/demo/raw/upload/cv.pdf",
    },
  });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token as string, cookie: r.cookie, username, id: r.data.user.id as string };
}

const results = { pass: 0, vuln: 0, fail: 0 };
function check(label: string, verdict: "PASS" | "VULN" | "FAIL", detail = "") {
  const mark = verdict === "PASS" ? "✓ PASS" : verdict === "VULN" ? "✗ VULN" : "✗ FAIL";
  results[verdict === "PASS" ? "pass" : verdict === "VULN" ? "vuln" : "fail"]++;
  console.log(`  ${mark}  ${label}${detail ? "  →  " + detail : ""}`);
}

/** exp - iat بتاع الـ JWT بالثواني */
function tokenLifetime(jwt: string): number {
  const p = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64").toString());
  return p.exp - p.iat;
}

async function main() {
  console.log(`\n=== Session / refresh tokens — run ${TAG} ===\n`);

  console.log("[ issue ]");
  const u = await register("alice");
  check("register issues an access token", !!u.token ? "PASS" : "FAIL");
  check("register sets a refresh cookie", !!u.cookie ? "PASS" : "FAIL");
  check(
    "access token lives 15 minutes, not 7 days",
    tokenLifetime(u.token) === 900 ? "PASS" : "VULN",
    `${tokenLifetime(u.token)}s`
  );

  const setCookieLine = (await fetch(`${B}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": RUN_IP },
    body: JSON.stringify({ identifier: u.username, password: "supersecret1" }),
  }).then((r) => r.headers.getSetCookie?.() ?? []))
    .find((c) => c.startsWith(REFRESH_COOKIE));
  check("refresh cookie is HttpOnly (XSS can't read it)", /HttpOnly/i.test(setCookieLine ?? "") ? "PASS" : "VULN");
  check("refresh cookie is scoped to /api/auth", /Path=\/api\/auth/i.test(setCookieLine ?? "") ? "PASS" : "FAIL");

  // --- CSRF ------------------------------------------------------
  console.log("\n[ csrf ]");
  const noHeader = await req("POST", "/api/auth/refresh", { cookie: u.cookie, csrf: false });
  check(
    "refresh without the custom header is refused",
    noHeader.status === 403 ? "PASS" : "VULN",
    `status ${noHeader.status}`
  );

  // --- rotation --------------------------------------------------
  console.log("\n[ rotation ]");
  const r1 = await req("POST", "/api/auth/refresh", { cookie: u.cookie });
  check("refresh returns a new access token", r1.status === 200 && !!r1.data?.token ? "PASS" : "FAIL", `status ${r1.status}`);
  check("refresh rotates the cookie", !!r1.cookie && r1.cookie !== u.cookie ? "PASS" : "VULN");

  const fresh = r1.cookie!;
  const meWithFresh = await req("GET", "/api/auth/me", { token: r1.data.token });
  check("the refreshed access token works", meWithFresh.status === 200 ? "PASS" : "FAIL");

  // --- concurrent tabs -------------------------------------------
  console.log("\n[ concurrent tabs ]");
  // نفس الكوكي مرتين مع بعض = تابين بيجدّدوا في نفس اللحظة. ده لازم يبقى
  // 409 "أعد المحاولة"، مش قفل للجلسة.
  const [a, b] = await Promise.all([
    req("POST", "/api/auth/refresh", { cookie: fresh }),
    req("POST", "/api/auth/refresh", { cookie: fresh }),
  ]);
  const statuses = [a.status, b.status].sort();
  check(
    "one tab wins, the other is told to retry (not logged out)",
    statuses[0] === 200 && statuses[1] === 409 ? "PASS" : "FAIL",
    `statuses ${statuses.join(" + ")}`
  );
  const winner = (a.status === 200 ? a : b).cookie!;
  const stillAlive = await req("POST", "/api/auth/refresh", { cookie: winner });
  check("the session survives the race", stillAlive.status === 200 ? "PASS" : "FAIL", `status ${stillAlive.status}`);
  const afterRace = stillAlive.cookie!;

  // --- reuse detection -------------------------------------------
  console.log("\n[ reuse detection ]");
  // بنرجّع rotatedAt لورا عشان نعدّي شباك السماح من غير ما نستنى 15 ثانية
  const stolen = fresh;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(stolen) },
    data: { rotatedAt: new Date(Date.now() - 60_000) },
  });

  const replay = await req("POST", "/api/auth/refresh", { cookie: stolen });
  check("replaying a burned token is refused", replay.status === 401 ? "PASS" : "VULN", `status ${replay.status}`);

  // ودي الحتة المهمة: إعادة الاستخدام معناها في نسختين، فالعيلة كلها تتقفل —
  // يعني اللص والضحية الاتنين يتطلعوا بره
  const victim = await req("POST", "/api/auth/refresh", { cookie: afterRace });
  check(
    "reuse kills the whole family, not just the replayed token",
    victim.status === 401 ? "PASS" : "VULN",
    `status ${victim.status}`
  );

  // --- logout ----------------------------------------------------
  console.log("\n[ logout ]");
  const u2 = await register("bob");
  const out = await req("POST", "/api/auth/logout", { cookie: u2.cookie });
  check("logout succeeds", out.status === 200 ? "PASS" : "FAIL");
  const afterLogout = await req("POST", "/api/auth/refresh", { cookie: u2.cookie });
  check(
    "the refresh token is dead server-side after logout",
    afterLogout.status === 401 ? "PASS" : "VULN",
    `status ${afterLogout.status}`
  );

  // --- sessions / per-device -------------------------------------
  console.log("\n[ per-device ]");
  const u3 = await register("carol");
  const login2 = await req("POST", "/api/auth/login", {
    body: { identifier: u3.username, password: "supersecret1" },
  });
  const deviceB = login2.cookie!;
  const sessions = await req("GET", "/api/auth/sessions", { token: u3.token, cookie: u3.cookie });
  check("both devices are listed", sessions.data?.sessions?.length === 2 ? "PASS" : "FAIL", `${sessions.data?.sessions?.length} session(s)`);
  check("the current device is flagged", sessions.data?.sessions?.some((s: any) => s.current) ? "PASS" : "FAIL");

  const other = sessions.data.sessions.find((s: any) => !s.current);
  const kill = await req("DELETE", `/api/auth/sessions/${other.id}`, { token: u3.token, cookie: u3.cookie });
  check("can sign out one device", kill.status === 200 ? "PASS" : "FAIL");
  const killedRefresh = await req("POST", "/api/auth/refresh", { cookie: deviceB });
  check("the signed-out device is dead", killedRefresh.status === 401 ? "PASS" : "VULN", `status ${killedRefresh.status}`);
  const survivor = await req("POST", "/api/auth/refresh", { cookie: u3.cookie });
  check("the other device still works", survivor.status === 200 ? "PASS" : "FAIL", `status ${survivor.status}`);

  // يوزر تاني مايقدرش يطلّع جلسات حد غيره
  const u4 = await register("mallory");
  const cross = await req("DELETE", `/api/auth/sessions/${other.id}`, { token: u4.token });
  check("can't kill someone else's session", cross.status === 404 ? "PASS" : "VULN", `status ${cross.status}`);

  // --- password reset --------------------------------------------
  console.log("\n[ password reset ]");
  const u5 = await register("dave");
  // بنقلّد إعادة تعيين: نفس اللي بيعمله الـ endpoint
  const resetToken = "x".repeat(64);
  await prisma.user.update({
    where: { id: u5.id },
    data: {
      resetTokenHash: sha256(resetToken),
      resetTokenExpiry: new Date(Date.now() + 3600_000),
    },
  });
  const reset = await req("POST", "/api/auth/reset-password", {
    body: { token: resetToken, password: "brandnewpass9" },
  });
  check("reset-password works", reset.status === 200 ? "PASS" : "FAIL", `status ${reset.status}`);
  const afterReset = await req("POST", "/api/auth/refresh", { cookie: u5.cookie });
  check(
    "resetting the password evicts existing sessions",
    afterReset.status === 401 ? "PASS" : "VULN",
    `status ${afterReset.status}`
  );

  console.log(`\n=== ${results.pass} pass · ${results.vuln} vuln · ${results.fail} fail ===\n`);
  process.exitCode = results.vuln + results.fail > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("\n✗ suite crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

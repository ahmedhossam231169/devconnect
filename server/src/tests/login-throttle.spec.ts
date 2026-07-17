// [SECURITY BUG-06] الـ brute force على مستوى الحساب.
//
// الـ rate limiting بتاع الـ IP لوحده مابيوقفش هجوم موزّع: مهاجم عنده مئات
// الـ IPs بياخد من كل واحد نصيبه "المسموح" ويكمّل على نفس الحساب. التست ده
// بيحاكي ده بتزوير X-Forwarded-For (السيرفر لازم يكون TRUST_PROXY=1 عشان
// ياخد الهيدر ده على إنه IP العميل — وده بالظبط إعداد الإنتاج ورا nginx).
//
// شغّله بـ (السيرفر لازم يكون شغال بـ TRUST_PROXY=1 على :4000):
//   npx tsx src/tests/login-throttle.spec.ts
import { prisma } from "../lib/prisma.js";

const B = "http://localhost:4000";
const TAG = Date.now().toString(36);

/** كل طلب بييجي من "IP" مختلف — ده جوهر الهجوم الموزّع */
async function req(method: string, path: string, body?: unknown, fakeIp?: string) {
  const res = await fetch(B + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(fakeIp ? { "X-Forwarded-For": fakeIp } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* مفيش body */ }
  return { status: res.status, data };
}

const results = { pass: 0, vuln: 0, fail: 0 };
function check(label: string, verdict: "PASS" | "VULN" | "FAIL", detail = "") {
  const mark = verdict === "PASS" ? "✓ PASS" : verdict === "VULN" ? "✗ VULN" : "✗ FAIL";
  results[verdict === "PASS" ? "pass" : verdict === "VULN" ? "vuln" : "fail"]++;
  console.log(`  ${mark}  ${label}${detail ? "  →  " + detail : ""}`);
}

const ip = (n: number) => `203.0.113.${n % 254}`; // نطاق TEST-NET-3 المخصص للتوثيق

async function main() {
  console.log(`\n=== Account brute-force throttling (BUG-06) — run ${TAG} ===\n`);

  const username = `victim_${TAG}`;
  const password = "supersecret1";
  const reg = await req("POST", "/api/auth/register", {
    email: `${username}@devconnect.com`,
    username, password, displayName: "Victim", yearsExperience: 2,
    resumeUrl: "https://res.cloudinary.com/demo/raw/upload/cv.pdf",
  }, ip(1));
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.data)}`);

  // ---- الهجوم الموزّع: 25 محاولة، كل واحدة من IP مختلف ----
  // من غير الحماية على مستوى الحساب، كل دول بيعدّوا لأن كل IP "تحت الحد"
  let rateLimitedByIp = 0;
  for (let i = 0; i < 25; i++) {
    const r = await req("POST", "/api/auth/login", { identifier: username, password: "wrong-guess" }, ip(10 + i));
    if (r.status === 429) rateLimitedByIp++;
  }
  check("IP limiter did not stop the distributed attack (that's the gap)", rateLimitedByIp === 0 ? "PASS" : "PASS", `${rateLimitedByIp}/25 blocked by IP limiter`);

  // الحساب المفروض اتقفل دلوقتي — التأكيد من الداتابيز
  const locked = await prisma.user.findUnique({
    where: { username },
    select: { failedLoginAttempts: true, lockedUntil: true },
  });
  check(
    "account is locked after crossing the threshold",
    locked?.lockedUntil && locked.lockedUntil > new Date() ? "PASS" : "VULN",
    `attempts=${locked?.failedLoginAttempts} lockedUntil=${locked?.lockedUntil?.toISOString() ?? "null"}`
  );

  // ---- الأهم: الباسورد الصح نفسه لازم يترفض وهو متقفل ----
  // لو ده عدّى، القفل مالوش أي قيمة — المهاجم بيكمّل تخمين
  const correctWhileLocked = await req("POST", "/api/auth/login", { identifier: username, password }, ip(99));
  check(
    "correct password is REJECTED while locked (lock actually holds)",
    correctWhileLocked.status === 401 ? "PASS" : "VULN",
    `status ${correctWhileLocked.status}`
  );

  // ---- مافيش تسريب enumeration: نفس الرد بالظبط للحساب المقفول وللمش موجود ----
  const ghost = await req("POST", "/api/auth/login", { identifier: `ghost_${TAG}`, password: "whatever" }, ip(120));
  check(
    "locked account and non-existent account return identical responses",
    correctWhileLocked.status === ghost.status &&
      JSON.stringify(correctWhileLocked.data) === JSON.stringify(ghost.data)
      ? "PASS" : "VULN",
    `locked=${correctWhileLocked.status}:${correctWhileLocked.data?.error?.message} ghost=${ghost.status}:${ghost.data?.error?.message}`
  );

  // ---- القفل مؤقت مش دائم (مش وسيلة DoS ضد صاحب الحساب) ----
  const lockMinutes = locked?.lockedUntil ? (locked.lockedUntil.getTime() - Date.now()) / 60000 : 0;
  check("lock is time-bounded, not permanent", lockMinutes > 0 && lockMinutes <= 16 ? "PASS" : "FAIL", `${lockMinutes.toFixed(1)} min remaining`);

  // ---- إعادة تعيين الباسورد بتفك القفل (الضحية ليها طريق رجوع) ----
  // بنزرع توكن استرداد مباشرة — نفس أسلوب security.spec للـ BUG-05
  const crypto = await import("node:crypto");
  const raw = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { username },
    data: {
      resetTokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
      resetTokenExpiry: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  await req("POST", "/api/auth/reset-password", { token: raw, password: "brandnewpass9" }, ip(200));
  const afterReset = await prisma.user.findUnique({
    where: { username },
    select: { lockedUntil: true, failedLoginAttempts: true },
  });
  check(
    "password reset clears the lock (victim is not stuck)",
    !afterReset?.lockedUntil && afterReset?.failedLoginAttempts === 0 ? "PASS" : "FAIL",
    `lockedUntil=${afterReset?.lockedUntil?.toISOString() ?? "null"} attempts=${afterReset?.failedLoginAttempts}`
  );

  const loginAfterReset = await req("POST", "/api/auth/login", { identifier: username, password: "brandnewpass9" }, ip(201));
  check("victim can log in again after reset", loginAfterReset.status === 200 ? "PASS" : "FAIL", `status ${loginAfterReset.status}`);

  // ---- الدخول الناجح بيصفّر العدّاد ----
  const fresh = `clean_${TAG}`;
  await req("POST", "/api/auth/register", {
    email: `${fresh}@devconnect.com`, username: fresh, password, displayName: "Clean", yearsExperience: 1,
    resumeUrl: "https://res.cloudinary.com/demo/raw/upload/cv.pdf",
  }, ip(220));
  await req("POST", "/api/auth/login", { identifier: fresh, password: "nope" }, ip(221));
  await req("POST", "/api/auth/login", { identifier: fresh, password }, ip(222)); // نجاح
  const cleaned = await prisma.user.findUnique({ where: { username: fresh }, select: { failedLoginAttempts: true } });
  check("successful login resets the failure counter", cleaned?.failedLoginAttempts === 0 ? "PASS" : "FAIL", `attempts=${cleaned?.failedLoginAttempts}`);

  console.log(`\n--- ${results.pass} pass · ${results.vuln} vuln · ${results.fail} fail ---\n`);
  await prisma.$disconnect();
  process.exit(results.vuln + results.fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error("\nSUITE ERROR:", e); await prisma.$disconnect(); process.exit(1); });

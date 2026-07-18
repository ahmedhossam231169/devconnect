// [SECURITY BUG-07] forgot-password ماكانش بيسرّب وجود الحساب في نص الرد،
// بس في توقيت الرد. الرسالة واحدة، لكن:
//   إيميل مسجّل بباسورد → findUnique + user.update + email قبل الرد
//   إيميل مش موجود       → findUnique بس قبل الرد
// فرق الـ round trip ده لـ Neon كان بيخلي مهاجم يعدّ الإيميلات المسجلة
// بقياس الزمن، حتى والرد متطابق حرفيًا.
//
// الإصلاح: الرد بيخرج قبل أي شغل بيعتمد على الحساب، فالتوقيت بقى ثابت.
//
// شغّله بـ (لازم السيرفر شغال على :4000، وداتابيز تجريبية):
//   TRUST_PROXY=1 EMAIL_DISABLED=1 npx tsx src/index.ts      # terminal 1
//   npx tsx src/tests/forgot-password-timing.spec.ts
//
// ⚠️ EMAIL_DISABLED=1 مش اختياري هنا: السويت بتضرب forgot-password ~50 مرة،
// ونص الطلبات دي لحساب موجود فعلاً. لو SMTP متظبط في .env (وهو كده)، من
// غير المفتاح ده بتتبعت إيميلات حقيقية من حسابك لعناوين وهمية — بتاكل
// الرصيد وبترفع نسبة الارتداد اللي بتضر سمعة المُرسِل.
//
// اصطلاح النتائج:
//   ✓ PASS = التوقيت ثابت (آمن)
//   ✗ VULN = التوقيت بيفرّق بين موجود ومش موجود (تسريب)
//   ✗ FAIL = التست نفسه ما اشتغلش
import { prisma } from "../lib/prisma.js";

const B = "http://localhost:4000";
const TAG = Date.now().toString(36);

// ⚠️ IP فريد لكل طلب — مش لكل تشغيلة. authLimiter بيسمح بـ 10 طلبات/IP كل
// 15 دقيقة، والتست بيبعت عشرات الطلبات. لو كلها من IP واحد، بعد العاشر
// بييجي 429 فوري (من غير أي شغل داتابيز) — فأغلب العينات بتبقى ردود
// موحّدة السرعة بتغسل فرق التوقيت وتخلي التست ينجح غلط. IP مختلف لكل
// طلب بيخلي الـ limiter ما يشتغلش، فبنقيس منطق الـ endpoint نفسه.
let ipCounter = 0;
function nextIp(): string {
  ipCounter++;
  // نطاق TEST-NET-2 (198.51.100.0/24) المخصص للتوثيق، موسّع للبايت التالت
  // عشان يكفي عشرات الطلبات من غير تكرار
  return `198.51.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

async function forgot(email: string): Promise<number> {
  const t0 = performance.now();
  await fetch(`${B}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": nextIp(),
      "X-Requested-With": "devconnect",
    },
    body: JSON.stringify({ email }),
  });
  return performance.now() - t0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const results = { pass: 0, vuln: 0, fail: 0 };
function check(label: string, verdict: "PASS" | "VULN" | "FAIL", detail = "") {
  const mark = verdict === "PASS" ? "✓ PASS" : verdict === "VULN" ? "✗ VULN" : "✗ FAIL";
  results[verdict === "PASS" ? "pass" : verdict === "VULN" ? "vuln" : "fail"]++;
  console.log(`  ${mark}  ${label}${detail ? "  →  " + detail : ""}`);
}

async function main() {
  console.log(`\n=== forgot-password timing (BUG-07) — run ${TAG} ===\n`);

  // حساب مسجّل بباسورد (المسار "البطيء" قبل الإصلاح)
  const username = `timing_${TAG}`;
  const email = `${username}@devconnect.com`;
  const reg = await fetch(`${B}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextIp() },
    body: JSON.stringify({
      email,
      username,
      password: "supersecret1",
      displayName: "Timing",
      yearsExperience: 3,
      resumeUrl: "https://res.cloudinary.com/demo/raw/upload/cv.pdf",
    }),
  });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);

  const missing = `nobody_${TAG}@example.com`;

  const SAMPLES = 25;
  // إحماء: أول طلب بيدفع تكاليف اتصال/JIT مش بتاعت المنطق
  await forgot(email);
  await forgot(missing);

  // بنلفّ متبادل بين الاتنين عشان أي انجراف في زمن الشبكة يتوزّع بالعدل
  const existing: number[] = [];
  const absent: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    existing.push(await forgot(email));
    absent.push(await forgot(missing));
  }

  const mE = median(existing);
  const mA = median(absent);
  const gap = Math.abs(mE - mA);
  console.log(`  registered:   median ${mE.toFixed(1)}ms`);
  console.log(`  unregistered: median ${mA.toFixed(1)}ms`);
  console.log(`  gap:          ${gap.toFixed(1)}ms\n`);

  // الحد. بعد الإصلاح المساران بيردّوا بعد الـ parse فالفرق ضوضاء (وحدات
  // مللي أو أقل). التسريب الحقيقي في الإنتاج هو زمن إرسال SMTP (مئات المللي
  // للثواني) اللي كان بيتعمل قبل الرد للحسابات الموجودة بس — والـ negative
  // control بيحاكيه بـ 200ms. 15ms أوسع بكتير من ضوضاء الميديان وأضيق بكتير
  // من أي تأخير إرسال حقيقي، فبيفصل "ثابت" عن "بيسرّب" بوضوح.
  const THRESHOLD_MS = 15;
  check(
    `response time doesn't reveal whether the email is registered (< ${THRESHOLD_MS}ms gap)`,
    gap < THRESHOLD_MS ? "PASS" : "VULN",
    `gap ${gap.toFixed(1)}ms`
  );

  // كمان: الرد نفسه لازم يفضل متطابق (خط الدفاع الأصلي)
  const rE = await fetch(`${B}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextIp() },
    body: JSON.stringify({ email }),
  }).then((r) => r.json());
  const rA = await fetch(`${B}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextIp() },
    body: JSON.stringify({ email: missing }),
  }).then((r) => r.json());
  check(
    "response body is identical for both",
    JSON.stringify(rE) === JSON.stringify(rA) ? "PASS" : "VULN",
    JSON.stringify(rE.message)
  );

  // نتأكد إن الشغل في الخلفية فعلًا حصل: التوكن اتكتب برغم إن الرد سبقه
  await new Promise((r) => setTimeout(r, 500)); // مهلة للشغل الخلفي
  const user = await prisma.user.findUnique({
    where: { email },
    select: { resetTokenHash: true },
  });
  check(
    "the reset token was still written (background work ran)",
    user?.resetTokenHash ? "PASS" : "FAIL"
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

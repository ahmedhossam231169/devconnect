// [SECURITY BUG-11] الحقول المرفوعة (أفاتار، بانر، صورة بوست، مرفق رسالة،
// CV) لازم تكون على Cloudinary بتاعنا — مش أي رابط http(s). قبل كده كان
// أي مستخدم يقدر يحط avatarUrl على سيرفر بيتحكم فيه، فمتصفح كل من يفتح
// البروفايل بيجيب الصورة من هناك (تسريب IP + تتبّع)، وبيتخطى Cloudinary
// تمامًا (مفيش حد حجم ولا إشراف).
//
// شغّله بـ (لازم السيرفر شغال على :4000، وداتابيز تجريبية):
//   TRUST_PROXY=1 npx tsx src/index.ts      # terminal 1
//   npx tsx src/tests/upload-host.spec.ts
//
// ملاحظة: بيختبر وضع "المضيف بس" (لما CLOUDINARY_CLOUD_NAME مش متظبط، وده
// وضع التطوير). ربط اسم الحساب بيتأكد منه تشغيل منفصل بالمتغيّر متظبط
// (شوف السطر في آخر الملف).
//
// اصطلاح النتائج:
//   ✓ PASS = التطبيق تصرّف صح (آمن)
//   ✗ VULN = رابط خبيث اتقبل
//   ✗ FAIL = التست نفسه ما اشتغلش
const B = "http://localhost:4000";
const TAG = Date.now().toString(36);
const RUN_IP = `203.0.113.${Math.floor(Math.random() * 254)}`;

async function req(method: string, path: string, token: string | undefined, body: unknown) {
  const res = await fetch(B + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": RUN_IP,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
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
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token as string;
}

const results = { pass: 0, vuln: 0, fail: 0 };
function check(label: string, verdict: "PASS" | "VULN" | "FAIL", detail = "") {
  const mark = verdict === "PASS" ? "✓ PASS" : verdict === "VULN" ? "✗ VULN" : "✗ FAIL";
  results[verdict === "PASS" ? "pass" : verdict === "VULN" ? "vuln" : "fail"]++;
  console.log(`  ${mark}  ${label}${detail ? "  →  " + detail : ""}`);
}

const GOOD = "https://res.cloudinary.com/demo/image/upload/v1/pic.jpg";

async function main() {
  console.log(`\n=== Upload host allowlist (BUG-11) — run ${TAG} ===\n`);
  const token = await register("uploader");

  console.log("[ profile avatar ]");
  const legit = await req("PUT", "/api/profiles/me", token, { avatarUrl: GOOD });
  check("a real Cloudinary avatar is accepted", legit.status === 200 ? "PASS" : "FAIL", `status ${legit.status}`);

  for (const [label, url] of [
    ["attacker-controlled host", "https://evil.example.com/track.png"],
    ["cloudinary look-alike host", "https://res.cloudinary.com.evil.com/x.png"],
    ["subdomain trick", "https://evilres.cloudinary.com/x.png"],
    ["data: URL", "data:image/png;base64,AAAA"],
    ["javascript: URL", "javascript:alert(1)"],
  ] as const) {
    const r = await req("PUT", "/api/profiles/me", token, { avatarUrl: url });
    check(`avatar rejects ${label}`, r.status === 422 ? "PASS" : "VULN", `status ${r.status}`);
  }

  console.log("\n[ post image ]");
  const okPost = await req("POST", "/api/posts", token, { type: "TEXT", body: "hi", imageUrl: GOOD });
  check("a real Cloudinary post image is accepted", okPost.status === 201 ? "PASS" : "FAIL", `status ${okPost.status}`);
  const badPost = await req("POST", "/api/posts", token, {
    type: "TEXT",
    body: "hi",
    imageUrl: "https://evil.example.com/pixel.gif",
  });
  check("post image rejects a foreign host", badPost.status === 422 ? "PASS" : "VULN", `status ${badPost.status}`);

  console.log("\n[ external links are NOT over-restricted ]");
  // websiteUrl و githubUrl روابط خارجية شرعية — لازم تفضل مقبولة، غير كده
  // بنبقى كسرنا ميزة عشان نأمّن حاجة تانية
  const site = await req("PUT", "/api/profiles/me", token, { websiteUrl: "https://my-portfolio.dev" });
  check("websiteUrl still accepts an arbitrary external site", site.status === 200 ? "PASS" : "FAIL", `status ${site.status}`);
  const gh = await req("PUT", "/api/profiles/me", token, { githubUrl: "https://github.com/someone" });
  check("githubUrl still accepts github.com", gh.status === 200 ? "PASS" : "FAIL", `status ${gh.status}`);
  // بس لسه بيرفض السكيمات الخطيرة
  const jsLink = await req("PUT", "/api/profiles/me", token, { websiteUrl: "javascript:alert(1)" });
  check("websiteUrl still rejects javascript:", jsLink.status === 422 ? "PASS" : "VULN", `status ${jsLink.status}`);

  console.log(`\n=== ${results.pass} pass · ${results.vuln} vuln · ${results.fail} fail ===\n`);
  process.exitCode = results.vuln + results.fail > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("\n✗ suite crashed:", err);
  process.exitCode = 1;
});

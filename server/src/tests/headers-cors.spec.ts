// [SECURITY #15] الترويسات و CORS — الفحوصات دي بتقفل الباب على regression
// صامت: تغيير صغير في helmet أو في إعداد CORS ممكن يفتح ثغرة من غير ما يكسر
// أي ميزة، فمحدش ياخد باله.
//
// أهم فحص هنا: الـ origin المجهول لازم مايترجعش في Access-Control-Allow-Origin.
// لو اترجع (reflection)، أي موقع يقدر يقرا ردود الـ API بهوية المستخدم —
// وعليه كمان بتنهار حماية CSRF بتاعة /refresh و /logout، لأنها معتمدة على إن
// الـ preflight يفشل للأصول الغريبة.
//
// شغّله بـ:
//   TRUST_PROXY=1 EMAIL_DISABLED=1 npx tsx src/index.ts   # terminal 1
//   npx tsx src/tests/headers-cors.spec.ts
//
// اصطلاح النتائج:
//   ✓ PASS = آمن   ✗ VULN = ثغرة مؤكدة   ✗ FAIL = التست ما اشتغلش
const B = "http://localhost:4000";
const TAG = Date.now().toString(36);
const ALLOWED = "http://localhost:5173"; // لازم يطابق CLIENT_URL في .env
const EVIL = "https://evil.example.com";

const results = { pass: 0, vuln: 0, fail: 0 };
function check(label: string, verdict: "PASS" | "VULN" | "FAIL", detail = "") {
  const mark = verdict === "PASS" ? "✓ PASS" : verdict === "VULN" ? "✗ VULN" : "✗ FAIL";
  results[verdict === "PASS" ? "pass" : verdict === "VULN" ? "vuln" : "fail"]++;
  console.log(`  ${mark}  ${label}${detail ? "  →  " + detail : ""}`);
}

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(B + path, { headers });

async function main() {
  console.log(`\n=== Headers & CORS (#15) — run ${TAG} ===\n`);

  console.log("[ security headers ]");
  const res = await get("/api/livez");
  const h = (n: string) => res.headers.get(n);

  check("X-Content-Type-Options: nosniff", h("x-content-type-options") === "nosniff" ? "PASS" : "VULN", h("x-content-type-options") ?? "missing");
  check("HSTS is set", /max-age=\d+/.test(h("strict-transport-security") ?? "") ? "PASS" : "VULN", h("strict-transport-security") ?? "missing");
  check("Referrer-Policy is set", !!h("referrer-policy") ? "PASS" : "VULN", h("referrer-policy") ?? "missing");
  check("CSP is set", !!h("content-security-policy") ? "PASS" : "VULN", h("content-security-policy") ? "present" : "missing");
  check("X-Frame-Options is set", !!h("x-frame-options") ? "PASS" : "VULN", h("x-frame-options") ?? "missing");
  // helmet بيشيلها — وجودها بيعلن الـ framework والإصدار لأي ماسح
  check("X-Powered-By is stripped", h("x-powered-by") === null ? "PASS" : "VULN", h("x-powered-by") ?? "absent");

  console.log("\n[ cache — personal data must not be stored ]");
  // من غير توجيه صريح المتصفح بيخزّن استدلاليًا، يعني بيانات المستخدم
  // بتتكتب على القرص وتفضل مقروءة بعد الخروج
  check("no-store on health", (h("cache-control") ?? "").includes("no-store") ? "PASS" : "VULN", h("cache-control") ?? "missing");

  const me = await get("/api/auth/me", { Authorization: "Bearer invalid" });
  check(
    "no-store on an authenticated route too",
    (me.headers.get("cache-control") ?? "").includes("no-store") ? "PASS" : "VULN",
    me.headers.get("cache-control") ?? "missing"
  );

  console.log("\n[ cors ]");
  const allowed = await get("/api/livez", { Origin: ALLOWED });
  check(
    "allowed origin is echoed",
    allowed.headers.get("access-control-allow-origin") === ALLOWED ? "PASS" : "FAIL",
    allowed.headers.get("access-control-allow-origin") ?? "missing"
  );

  // ★ الفحص الجوهري
  const evil = await get("/api/livez", { Origin: EVIL });
  const evilAcao = evil.headers.get("access-control-allow-origin");
  check(
    "unknown origin is NOT reflected",
    evilAcao === null ? "PASS" : "VULN",
    evilAcao ?? "(no ACAO — correct)"
  );
  check(
    "unknown origin isn't answered with a wildcard either",
    evilAcao !== "*" ? "PASS" : "VULN",
    evilAcao ?? "(none)"
  );

  check(
    "Vary: Origin is set (a cache can't serve one origin's decision to another)",
    (allowed.headers.get("vary") ?? "").toLowerCase().includes("origin") ? "PASS" : "VULN",
    allowed.headers.get("vary") ?? "missing"
  );

  console.log("\n[ csrf preflight — the chain protecting /refresh ]");
  const preflight = async (origin: string) =>
    fetch(`${B}/api/auth/refresh`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-requested-with",
      },
    });

  const evilPre = await preflight(EVIL);
  check(
    "preflight from a foreign origin gets no ACAO (browser blocks the real request)",
    evilPre.headers.get("access-control-allow-origin") === null ? "PASS" : "VULN",
    evilPre.headers.get("access-control-allow-origin") ?? "(none — correct)"
  );

  const okPre = await preflight(ALLOWED);
  check(
    "preflight from our own origin is allowed",
    okPre.headers.get("access-control-allow-origin") === ALLOWED ? "PASS" : "FAIL",
    okPre.headers.get("access-control-allow-origin") ?? "missing"
  );

  // الطبقة التانية: حتى لو حد عدّى الـ preflight، الراوت نفسه بيرفض
  const noHeader = await fetch(`${B}/api/auth/refresh`, { method: "POST" });
  check(
    "refresh without the custom header is refused at the route",
    noHeader.status === 403 ? "PASS" : "VULN",
    `status ${noHeader.status}`
  );

  console.log("\n[ body size limit & malformed input ]");
  const big = await fetch(`${B}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "x".repeat(2 * 1024 * 1024), password: "y" }),
  });
  // 413 مش 500: الحد كان بيتطبّق صح من الأول، بس الرد كان بيقول "مشكلة في
  // السيرفر" لخطأ من العميل — وده بيغرق أي error monitoring بأعطال وهمية
  check("a 2MB body is rejected as 413, not 500", big.status === 413 ? "PASS" : "FAIL", `status ${big.status}`);

  const malformed = await fetch(`${B}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  check("malformed JSON is a 400, not 500", malformed.status === 400 ? "PASS" : "FAIL", `status ${malformed.status}`);

  console.log(`\n=== ${results.pass} pass · ${results.vuln} vuln · ${results.fail} fail ===\n`);
  process.exitCode = results.vuln + results.fail > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("\n✗ suite crashed:", err);
  process.exitCode = 1;
});

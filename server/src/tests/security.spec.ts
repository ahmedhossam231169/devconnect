// اختبار أمان end-to-end — بيثبت ثغرات الـ access control المكتشفة في المراجعة
// بيشتغل على سيرفر حقيقي + DB حقيقي زي باقي الـ specs. شغّله بـ:
//   npx tsx src/tests/security.spec.ts
// كل تشغيلة بتستخدم إيميلات/يوزرنيمز فريدة (timestamp) عشان ما تصطدمش مع اللي قبلها.
//
// اصطلاح النتائج:
//   ✓ PASS      = التطبيق تصرّف صح (آمن)
//   ✗ VULN      = سلوك غير آمن اتأكد (bug — راجع BUG_REPORT)
//   ✗ FAIL      = التست نفسه ما اشتغلش زي المتوقع
import { io as ioc, type Socket } from "socket.io-client";

const B = "http://localhost:4000";
const TAG = Date.now().toString(36); // لكل تشغيلة هوية فريدة

async function req(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(B + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
    setTimeout(() => reject(new Error("timeout")), 4000);
  });
}

// helper بسيط للإبلاغ — بيطبع السطر وبيعدّ
const results = { pass: 0, vuln: 0, fail: 0 };
function check(label: string, verdict: "PASS" | "VULN" | "FAIL", detail = "") {
  const mark = verdict === "PASS" ? "✓ PASS" : verdict === "VULN" ? "✗ VULN" : "✗ FAIL";
  results[verdict === "PASS" ? "pass" : verdict === "VULN" ? "vuln" : "fail"]++;
  console.log(`  ${mark}  ${label}${detail ? "  →  " + detail : ""}`);
}

async function register(handle: string, role: "DEVELOPER" | "RECRUITER" = "DEVELOPER") {
  const r = await req("POST", "/api/auth/register", undefined, {
    email: `${handle}_${TAG}@sec.io`,
    username: `${handle}_${TAG}`,
    password: "supersecret1",
    displayName: handle,
    role,
  });
  return { token: r.data?.token as string, username: `${handle}_${TAG}`, status: r.status };
}

async function main() {
  console.log(`\n=== DevConnect Security Suite (run ${TAG}) ===\n`);

  // ---------------------------------------------------------------
  // Setup: 3 devs + 1 self-registered recruiter
  // ---------------------------------------------------------------
  const owner = await register("owner");
  const member = await register("member");
  const outsider = await register("outsider");
  const recruiter = await register("recruiter", "RECRUITER");
  console.log("setup: registered owner/member/outsider/recruiter\n");

  // ===============================================================
  // BUG-01 (HIGH → FIXED) — Talent search must respect the `discoverable`
  //   opt-in. تسجيل الـ RECRUITER مفتوح بالتصميم (اخترنا حماية البيانات
  //   بالـ opt-in بدل قفل الدور)؛ الضمان إن غير الموافقين ما يتعدّوش.
  // ===============================================================
  console.log("BUG-01  Talent search respects `discoverable` opt-in");
  {
    check(
      "register as RECRUITER is allowed (open self-signup by design)",
      recruiter.status === 201 ? "PASS" : "FAIL",
      `status ${recruiter.status}`
    );

    // owner/member/outsider اتسجّلوا كـ developers ومحدش عمل opt-in لسه
    const before = await req("GET", "/api/talent/search", recruiter.token);
    const namesBefore: string[] = (before.data?.candidates ?? []).map((c: any) => c.username);
    const nonOptedLeaked = [owner.username, member.username, outsider.username].filter((u) => namesBefore.includes(u));
    check(
      "non-opted developers are NOT enumerable via /talent/search",
      nonOptedLeaked.length === 0 ? "PASS" : "VULN",
      nonOptedLeaked.length ? `leaked: ${nonOptedLeaked.join(", ")}` : "none leaked"
    );

    // owner يفعّل الظهور صراحةً
    await req("PUT", "/api/profiles/me", owner.token, { discoverable: true, specialty: "Backend" });
    const after = await req("GET", "/api/talent/search", recruiter.token);
    const namesAfter: string[] = (after.data?.candidates ?? []).map((c: any) => c.username);
    check(
      "opted-in developer DOES appear in results",
      namesAfter.includes(owner.username) ? "PASS" : "FAIL",
      `owner present=${namesAfter.includes(owner.username)}`
    );
    check(
      "opting in one dev does NOT expose the others",
      !namesAfter.includes(member.username) && !namesAfter.includes(outsider.username) ? "PASS" : "VULN",
      `member/outsider present=${namesAfter.includes(member.username) || namesAfter.includes(outsider.username)}`
    );
  }

  // ===============================================================
  // Setup private community with a members-only post
  // ===============================================================
  const created = await req("POST", "/api/communities", owner.token, {
    name: `Secret Guild ${TAG}`, description: "private", category: "Backend",
  });
  const slug = created.data?.community?.slug;
  await req("POST", `/api/communities/${slug}/join`, member.token); // ينضم والكوميونتي لسه عام
  await req("PATCH", `/api/communities/${slug}`, owner.token, { isPrivate: true }); // بعدين يبقى خاص
  // owner ينشر بوست جوه الكوميونتي الخاص
  const secretPost = await req("POST", `/api/communities/${slug}/posts`, owner.token, {
    type: "TEXT", body: `TOP SECRET internal note ${TAG}`,
  });
  const postId = secretPost.data?.post?.id;
  console.log(`\nsetup: private community '${slug}' + secret post ${postId}\n`);

  // ===============================================================
  // BUG-02 (HIGH) — Private-community post sub-resources not gated
  //   permalink GET /posts/:id بيتحجب صح، لكن /comments /reactions /reposts
  //   و POST like/comment/repost مش بيتحققوا من العضوية أو الرؤية
  // ===============================================================
  console.log("BUG-02  Private-community post sub-resources gated by visibility");
  {
    // القراءة المباشرة للـ permalink المفروض تترفض (خط الدفاع الشغّال)
    const permalink = await req("GET", `/api/posts/${postId}`, outsider.token);
    check(
      "control: GET /posts/:id permalink blocked for outsider",
      permalink.status === 404 ? "PASS" : "VULN",
      `status ${permalink.status}`
    );

    const comments = await req("GET", `/api/posts/${postId}/comments`, outsider.token);
    check(
      "GET /posts/:id/comments blocked for outsider (404)",
      comments.status === 404 ? "PASS" : "VULN",
      `status ${comments.status}`
    );

    const reactions = await req("GET", `/api/posts/${postId}/reactions`, outsider.token);
    check(
      "GET /posts/:id/reactions blocked for outsider (404)",
      reactions.status === 404 ? "PASS" : "VULN",
      `status ${reactions.status}`
    );

    const reposts = await req("GET", `/api/posts/${postId}/reposts`, outsider.token);
    check(
      "GET /posts/:id/reposts blocked for outsider (404)",
      reposts.status === 404 ? "PASS" : "VULN",
      `status ${reposts.status}`
    );

    const like = await req("POST", `/api/posts/${postId}/like`, outsider.token, { type: "LIKE" });
    check(
      "POST /posts/:id/like blocked for outsider (404)",
      like.status === 404 ? "PASS" : "VULN",
      `status ${like.status}`
    );

    const comment = await req("POST", `/api/posts/${postId}/comments`, outsider.token, { body: "I can see this" });
    check(
      "POST /posts/:id/comments blocked for outsider (404)",
      comment.status === 404 ? "PASS" : "VULN",
      `status ${comment.status}`
    );

    // positive control: العضو لسه بيقرا ويتفاعل عادي
    const memberRead = await req("GET", `/api/posts/${postId}/comments`, member.token);
    check(
      "control: member CAN still read comments of private post",
      memberRead.status === 200 ? "PASS" : "VULN",
      `status ${memberRead.status}`
    );
    const memberLike = await req("POST", `/api/posts/${postId}/like`, member.token, { type: "LIKE" });
    check(
      "control: member CAN still like private post",
      memberLike.status === 200 ? "PASS" : "VULN",
      `status ${memberLike.status}`
    );
  }

  // ===============================================================
  // BUG-03 (MEDIUM → FIXED) — Private roster/details hidden from non-members
  // ===============================================================
  console.log("\nBUG-03  Private community roster/details hidden from non-members");
  {
    const members = await req("GET", `/api/communities/${slug}/members`, outsider.token);
    check(
      "GET /communities/:slug/members blocked for non-member (403)",
      members.status === 403 ? "PASS" : "VULN",
      `status ${members.status}`
    );
    const detail = await req("GET", `/api/communities/${slug}`, outsider.token);
    check(
      "GET /communities/:slug hides memberPreview from non-member",
      detail.status === 200 && (detail.data?.community?.memberPreview?.length ?? 0) === 0 ? "PASS" : "VULN",
      `previewCount=${detail.data?.community?.memberPreview?.length ?? "-"}`
    );
    // positive control: العضو لسه بيشوف الروستر
    const memberRoster = await req("GET", `/api/communities/${slug}/members`, member.token);
    check(
      "control: member CAN still see private community roster",
      memberRoster.status === 200 && (memberRoster.data?.members?.length ?? 0) > 0 ? "PASS" : "VULN",
      `status ${memberRoster.status}, members=${memberRoster.data?.members?.length ?? "-"}`
    );
  }

  // ===============================================================
  // BUG-04 (MEDIUM → FIXED) — Block hides blocker from blocked user's reads
  //   owner يحظر outsider، وبعدها outsider مايشوفش بروفايله/بوستاته/في البحث
  // ===============================================================
  console.log("\nBUG-04  Block hides blocker from the blocked user's reads");
  {
    const block = await req("POST", `/api/moderation/block/${outsider.username}`, owner.token);
    check("control: block created", block.data?.blocked ? "PASS" : "FAIL", `blocked=${block.data?.blocked}`);

    // تأكيد إن الحظر شغّال على التفاعل (خط الدفاع الموجود)
    const follow = await req("POST", `/api/friends/follow/${owner.username}`, outsider.token);
    check(
      "control: blocked user CANNOT follow (interaction blocked)",
      follow.status === 403 ? "PASS" : "VULN",
      `status ${follow.status}`
    );

    // والقراءة كمان بقت محجوبة
    const profile = await req("GET", `/api/profiles/${owner.username}`, outsider.token);
    check(
      "blocked user CANNOT GET blocker's profile (404)",
      profile.status === 404 ? "PASS" : "VULN",
      `status ${profile.status}`
    );
    const posts = await req("GET", `/api/posts/user/${owner.username}`, outsider.token);
    check(
      "blocked user CANNOT GET blocker's posts (404)",
      posts.status === 404 ? "PASS" : "VULN",
      `status ${posts.status}`
    );
    const search = await req("GET", `/api/search?q=${encodeURIComponent(owner.username)}`, outsider.token);
    const inResults = (search.data?.users ?? []).some((u: any) => u.username === owner.username);
    check(
      "blocked user does NOT find blocker in search",
      !inResults ? "PASS" : "VULN",
      `found=${inResults}`
    );
    // positive control: طرف تالت مش محظور لسه بيشوف البروفايل
    const memberView = await req("GET", `/api/profiles/${owner.username}`, member.token);
    check(
      "control: non-blocked user CAN still view the profile",
      memberView.status === 200 ? "PASS" : "VULN",
      `status ${memberView.status}`
    );
  }

  // ===============================================================
  // Positive controls — الحاجات اللي المفروض تكون آمنة فعلاً
  // ===============================================================
  console.log("\nCONTROLS  Auth / IDOR protections that SHOULD hold");
  {
    // JWT: توكن متلاعب فيه → 401
    const goodToken = owner.token;
    const tampered = goodToken.slice(0, -3) + "xxx";
    const t1 = await req("GET", "/api/auth/me", tampered);
    check("tampered JWT rejected on /auth/me", t1.status === 401 ? "PASS" : "VULN", `status ${t1.status}`);

    // مفيش توكن → 401
    const t2 = await req("GET", "/api/auth/me");
    check("missing JWT rejected on /auth/me", t2.status === 401 ? "PASS" : "VULN", `status ${t2.status}`);

    // developer عادي → /talent/search ممنوع
    const t3 = await req("GET", "/api/talent/search", owner.token);
    check("DEVELOPER blocked from /talent/search", t3.status === 403 ? "PASS" : "VULN", `status ${t3.status}`);

    // response التسجيل ما بيسربش passwordHash
    const me = await req("GET", "/api/auth/me", owner.token);
    const leaks = me.data?.user && "passwordHash" in me.data.user;
    check("/auth/me does NOT leak passwordHash", leaks ? "VULN" : "PASS");

    // Socket: توكن غلط → الاتصال يترفض
    try {
      await connect("garbage-token");
      check("socket rejects invalid token", "VULN", "connected with bad token");
    } catch {
      check("socket rejects invalid token", "PASS");
    }

    // Notification IDOR: member يحاول يعلّم إشعار مش بتاعه مقروء
    const ownerNotifs = await req("GET", "/api/notifications", owner.token);
    const someId = ownerNotifs.data?.notifications?.[0]?.id;
    if (someId) {
      const idor = await req("POST", `/api/notifications/${someId}/read`, member.token);
      check("cannot mark another user's notification read", idor.status === 404 ? "PASS" : "VULN", `status ${idor.status}`);
    } else {
      check("notification IDOR probe skipped (no notif)", "PASS");
    }

    // Zod validation: بوست فاضي → 422
    const bad = await req("POST", "/api/posts", owner.token, { type: "TEXT", body: "" });
    check("empty post body rejected (422)", bad.status === 422 ? "PASS" : "FAIL", `status ${bad.status}`);

    // javascript: URL في avatar → مرفوض
    const badUrl = await req("PUT", "/api/profiles/me", owner.token, { avatarUrl: "javascript:alert(1)" });
    check("javascript: avatar URL rejected", badUrl.status === 422 ? "PASS" : "VULN", `status ${badUrl.status}`);
  }

  // ---------------------------------------------------------------
  console.log(`\n=== RESULTS: ${results.pass} passed · ${results.vuln} vulnerabilities · ${results.fail} test-failures ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("SUITE CRASH:", e); process.exit(1); });

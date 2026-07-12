const B = "http://localhost:4000";

async function req(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(B + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  // 1) نسجل 3 مطورين + recruiter واحد
  const alex = await req("POST", "/api/auth/register", undefined, {
    email: "alex@dc.io", username: "alex_rivers", password: "supersecret1", displayName: "Alex Rivers",
  });
  const sarah = await req("POST", "/api/auth/register", undefined, {
    email: "sarah@dc.io", username: "sarah_chen", password: "supersecret1", displayName: "Sarah Chen",
  });
  const marcus = await req("POST", "/api/auth/register", undefined, {
    email: "marcus@dc.io", username: "marcus_t", password: "supersecret1", displayName: "Marcus Thorne",
  });
  const recruiter = await req("POST", "/api/auth/register", undefined, {
    email: "hr@dc.io", username: "hr_felix", password: "supersecret1", displayName: "Felix (HR)", role: "RECRUITER",
  });
  console.log("1) registered 3 devs + 1 recruiter →", [alex, sarah, marcus, recruiter].map((r) => r.status));

  const [tAlex, tSarah, tMarcus, tHR] = [alex, sarah, marcus, recruiter].map((r) => r.data.token);

  // 2) نكمّل بروفايلات المطورين (specialty, years, skills, availability)
  // discoverable:true — لازم للـ opt-in الجديد عشان يظهروا في talent search (BUG-01 fix)
  const u1 = await req("PUT", "/api/profiles/me", tAlex, {
    specialty: "Full Stack", yearsExperience: 8, availability: "OPEN_TO_WORK", location: "San Francisco, CA",
    discoverable: true,
    skills: [{ name: "React", years: 6 }, { name: "TypeScript", years: 5 }, { name: "Node.js", years: 4 }],
  });
  const u2 = await req("PUT", "/api/profiles/me", tSarah, {
    specialty: "AI/ML", yearsExperience: 5, availability: "OPEN_TO_WORK",
    discoverable: true,
    skills: [{ name: "Python", years: 5 }, { name: "TensorFlow", years: 3 }],
  });
  const u3 = await req("PUT", "/api/profiles/me", tMarcus, {
    specialty: "Full Stack", yearsExperience: 2, availability: "NOT_LOOKING",
    discoverable: true,
    skills: [{ name: "React", years: 2 }],
  });
  console.log("2) profile updates →", [u1, u2, u3].map((r) => r.status));
  console.log("   alex skills saved:", JSON.stringify(u1.data.profile.skills));

  // 3) مطور عادي يحاول يوصل للـ talent search → 403 forbidden
  const devTry = await req("GET", "/api/talent/search", tAlex);
  console.log("3) developer hits /talent/search →", devTry.status, devTry.data.error?.code);

  // 4) recruiter يدور بـ specialty=Full Stack + availability=OPEN_TO_WORK
  //    المفروض يرجع Alex بس (Marcus full stack بس NOT_LOOKING)
  const s1 = await req("GET", "/api/talent/search?specialty=Full+Stack&availability=OPEN_TO_WORK", tHR);
  console.log("4) specialty+availability filter → count:", s1.data.candidates.length, "| names:", s1.data.candidates.map((c: any) => c.displayName));

  // 5) فلترة بالـ skill: React → المفروض تجيب Alex و Marcus (مش Sarah)
  const s2 = await req("GET", "/api/talent/search?skills=React", tHR);
  console.log("5) skill=React filter → names:", s2.data.candidates.map((c: any) => c.displayName));

  // 6) فلترة بـ minYears=5 → المفروض Alex و Sarah بس (Marcus عنده 2 سنة)
  const s3 = await req("GET", "/api/talent/search?minYears=5", tHR);
  console.log("6) minYears=5 filter → names:", s3.data.candidates.map((c: any) => c.displayName));

  // 7) فلترة بـ skills متعددة (React + TypeScript) → لازم تجيب Alex بس (AND semantics)
  const s4 = await req("GET", "/api/talent/search?skills=React&skills=TypeScript", tHR);
  console.log("7) skills=React AND TypeScript → names:", s4.data.candidates.map((c: any) => c.displayName));

  // 8) بحث بالاسم q=marcus
  const s5 = await req("GET", "/api/talent/search?q=marcus", tHR);
  console.log("8) q=marcus text search → names:", s5.data.candidates.map((c: any) => c.displayName));

  // 9) صفحة تفاصيل المرشح العامة (بروفايل بالـ username)
  const detail = await req("GET", "/api/profiles/alex_rivers", tHR);
  console.log("9) candidate detail → specialty:", detail.data.profile.specialty, "| skills:", detail.data.profile.skills.length);

  // 10) الـ facets (كل الـ skills المستخدمة في المنصة)
  const facets = await req("GET", "/api/talent/facets", tHR);
  console.log("10) facets skills →", facets.data.skills);

  process.exit(0);
}

main().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });

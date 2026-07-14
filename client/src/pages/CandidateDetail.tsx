import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { Profile, GitHubProject } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { MatchScoreBar, STAGES, STAGE_META, type Stage } from "./RecruiterDashboard";
import {
  ArrowLeft, Clock, MapPin, Briefcase, Star as StarIcon, GitFork, FileText,
  MessageCircle, XCircle, CheckCircle2, TrendingUp, StickyNote, Plus,
} from "lucide-react";
import { GitHubIcon } from "../components/AuthLayout";

// ---------------------------------------------------------------
// Candidate Detail — صفحة 10 في الديزاين
// Career Roadmap + Skills proficiency + Open Source Activity +
// Internal Notes + Resume + أكشنز الـ pipeline — كله داتا حقيقية
// ---------------------------------------------------------------

interface CandidateUser {
  username: string;
  role: string;
  createdAt: string;
}

interface CandidateApplication {
  id: string;
  stage: Stage;
  note: string | null;
  job: { id: string; title: string; skills: string[]; status: "OPEN" | "CLOSED" };
}

interface MyJob {
  id: string;
  title: string;
  skills: string[];
  status: "OPEN" | "CLOSED";
}

const AVAILABILITY_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN_TO_WORK: { label: "Open to Work", cls: "bg-emerald-500/15 text-emerald-400" },
  FREELANCE_ONLY: { label: "Freelance Only", cls: "bg-sky-500/15 text-sky-400" },
  NOT_LOOKING: { label: "Not Looking", cls: "bg-ink-700 text-mist-400" },
};

// مستوى الإتقان من سنين الخبرة بالمهارة
function skillLevel(years: number): { label: string; pct: number } {
  if (years >= 8) return { label: "Expert", pct: Math.min(100, 90 + years - 8) };
  if (years >= 5) return { label: "Advanced", pct: 70 + (years - 5) * 6 };
  if (years >= 2) return { label: "Intermediate", pct: 45 + (years - 2) * 8 };
  return { label: "Beginner", pct: 20 + years * 12 };
}

function matchScore(jobSkills: string[], candidateSkills: string[]): number | null {
  if (jobSkills.length === 0) return null;
  const set = new Set(candidateSkills.map((s) => s.toLowerCase()));
  return Math.round((jobSkills.filter((s) => set.has(s.toLowerCase())).length / jobSkills.length) * 100);
}

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);

export default function CandidateDetail() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<CandidateUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reputation, setReputation] = useState(0);
  const [projects, setProjects] = useState<GitHubProject[]>([]);
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [myJobs, setMyJobs] = useState<MyJob[]>([]);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [shortlisted, setShortlisted] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const [pickJobOpen, setPickJobOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setError(null);
    api<{ ok: true; user: CandidateUser; profile: Profile; reputation: number }>(`/api/profiles/${username}`)
      .then((res) => {
        setUser(res.user);
        setProfile(res.profile);
        setReputation(res.reputation);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this profile"))
      .finally(() => setLoading(false));

    // بيانات مكملة — في الخلفية
    api<{ ok: true; projects: GitHubProject[] }>(`/api/profiles/${username}/github-projects`)
      .then((r) => setProjects(r.projects)).catch(() => {});
    api<{ ok: true; applications: CandidateApplication[] }>(`/api/jobs/candidate/${username}`)
      .then((r) => setApplications(r.applications)).catch(() => {});
    api<{ ok: true; jobs: MyJob[] }>("/api/jobs")
      .then((r) => setMyJobs(r.jobs.filter((j) => j.status === "OPEN"))).catch(() => {});
    api<{ ok: true; saved: boolean; note: string | null }>(`/api/shortlist/check/${username}`)
      .then((r) => { setShortlisted(r.saved); setNote(r.note ?? ""); setSavedNote(r.note); })
      .catch(() => {});
  }, [username]);

  const candidateSkillNames = profile?.skills.map((s) => s.name) ?? [];
  // أفضل match مع وظايفي المفتوحة
  const bestMatch = myJobs
    .map((j) => ({ job: j, score: matchScore(j.skills, candidateSkillNames) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;

  const activeApp = applications.find((a) => a.stage !== "REJECTED") ?? applications[0] ?? null;

  async function messageCandidate() {
    if (!username) return;
    setStartingChat(true);
    try {
      await api("/api/conversations", { method: "POST", body: JSON.stringify({ username }) });
      navigate("/messages");
    } finally {
      setStartingChat(false);
    }
  }

  async function saveNote() {
    if (!username) return;
    setSavingNote(true);
    try {
      await api("/api/shortlist", { method: "POST", body: JSON.stringify({ username, note: note || undefined }) });
      setShortlisted(true);
      setSavedNote(note || null);
    } finally {
      setSavingNote(false);
    }
  }

  async function addToPipeline(jobId: string) {
    if (!username) return;
    setBusy(true);
    try {
      // Shortlist & Add to Pipeline — الاتنين مع بعض زي زرار الديزاين
      if (!shortlisted) {
        await api("/api/shortlist", { method: "POST", body: JSON.stringify({ username }) }).catch(() => {});
        setShortlisted(true);
      }
      const res = await api<{ ok: true; application: { id: string; stage: Stage } }>(
        `/api/jobs/${jobId}/candidates`,
        { method: "POST", body: JSON.stringify({ username }) }
      );
      const job = myJobs.find((j) => j.id === jobId);
      setApplications((prev) => [
        { id: res.application.id, stage: res.application.stage, note: null, job: { id: jobId, title: job?.title ?? "", skills: job?.skills ?? [], status: "OPEN" } },
        ...prev.filter((a) => a.job.id !== jobId),
      ]);
      setPickJobOpen(false);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't add to pipeline");
    } finally {
      setBusy(false);
    }
  }

  async function setStage(app: CandidateApplication, stage: Stage) {
    setApplications((prev) => prev.map((a) => (a.id === app.id ? { ...a, stage } : a)));
    await api(`/api/jobs/applications/${app.id}`, { method: "PATCH", body: JSON.stringify({ stage }) }).catch(() => {});
  }

  const totalStars = projects.reduce((s, p) => s + p.stars, 0);
  const totalForks = projects.reduce((s, p) => s + p.forks, 0);
  const languages = [...projects.reduce((m, p) => {
    if (p.language) m.set(p.language, (m.get(p.language) ?? 0) + 1);
    return m;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <AppShell width="wide">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/talent/dashboard" className="inline-flex items-center gap-1.5 text-sm text-mist-400 hover:text-mist-100">
          <ArrowLeft size={15} /> Back to Dashboard
        </Link>
        {profile?.availability === "OPEN_TO_WORK" && (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
            Open to Work
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-4">
          <div className="h-40 animate-pulse rounded-2xl bg-ink-700/40" />
          <div className="h-64 animate-pulse rounded-2xl bg-ink-700/40" />
        </div>
      )}

      {error && (
        <div className="card !p-8 text-center">
          <p className="font-semibold text-red-400">{error}</p>
        </div>
      )}

      {!loading && profile && user && (
        <>
          {/* ===== الهيدر ===== */}
          <div className="card overflow-hidden !p-0">
            <div className="h-16 w-full" style={{ background: "linear-gradient(105deg, #164e63 0%, #4338ca 60%, #312e81 100%)" }} />
            <div className="flex flex-wrap items-center gap-5 p-6 pt-0">
              <div className="-mt-8 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-ink-800 bg-ink-700 text-2xl font-bold">
                {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : profile.displayName?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-extrabold">{profile.displayName}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-mist-400">
                  {profile.location && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {profile.location}</span>}
                  <span className="inline-flex items-center gap-1"><Briefcase size={13} /> {profile.specialty ?? "—"}</span>
                  <span className="inline-flex items-center gap-1"><Clock size={13} /> {profile.yearsExperience ?? 0}+ Years Exp.</span>
                  {profile.availability && AVAILABILITY_BADGE[profile.availability] && (
                    <span className={"rounded-full px-2 py-0.5 text-xs font-semibold " + AVAILABILITY_BADGE[profile.availability]!.cls}>
                      {AVAILABILITY_BADGE[profile.availability]!.label}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex divide-x divide-ink-700/60 rounded-xl border border-ink-700/60 bg-ink-900/60">
                <div className="px-5 py-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-mist-600">Match Score</p>
                  {bestMatch && bestMatch.score !== null ? (
                    <>
                      <p className="mt-0.5 text-2xl font-extrabold text-brand-400">{bestMatch.score}%</p>
                      <p className="max-w-28 truncate text-[10px] text-mist-600" title={bestMatch.job.title}>{bestMatch.job.title}</p>
                    </>
                  ) : (
                    <p className="mt-0.5 text-sm text-mist-600">No open roles<br />with skills</p>
                  )}
                </div>
                <div className="px-5 py-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-mist-600">Reputation</p>
                  <p className="mt-0.5 text-2xl font-extrabold">{fmt(reputation)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
            {/* ===== العمود الشمال ===== */}
            <div className="space-y-6">
              {/* Professional Skills */}
              <section className="card !p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold"><StarIcon size={14} className="text-brand-400" /> Professional Skills</h2>
                {profile.skills.length === 0 && <p className="mt-3 text-sm text-mist-600">No skills listed.</p>}
                <div className="mt-4 space-y-4">
                  {profile.skills.map((s) => {
                    const lvl = skillLevel(s.years);
                    return (
                      <div key={s.name}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-semibold">{s.name}</span>
                          <span className="text-xs text-mist-600">{s.years} yrs</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-900">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${lvl.pct}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-mist-600">{lvl.label}</p>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Open Source Activity */}
              <section className="card !p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold"><span className="text-brand-400"><GitHubIcon size={14} /></span> Open Source Activity</h2>
                {projects.length === 0 ? (
                  <p className="mt-3 text-sm text-mist-600">No public GitHub data.</p>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-ink-700/60 bg-ink-900/60 p-3 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-mist-600">Repos</p>
                        <p className="mt-0.5 text-xl font-extrabold">{projects.length}</p>
                      </div>
                      <div className="rounded-xl border border-ink-700/60 bg-ink-900/60 p-3 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-mist-600">Stars</p>
                        <p className="mt-0.5 text-xl font-extrabold text-cyan-400">{fmt(totalStars)}</p>
                      </div>
                      <div className="col-span-2 rounded-xl border border-ink-700/60 bg-ink-900/60 p-3 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-mist-600">Forks</p>
                        <p className="mt-0.5 text-xl font-extrabold text-brand-400">{fmt(totalForks)}</p>
                      </div>
                    </div>
                    {languages.length > 0 && (
                      <>
                        <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-mist-600">Top Languages</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {languages.map(([lang]) => (
                            <span key={lang} className="rounded-full bg-brand-500/10 px-2.5 py-0.5 text-xs font-semibold text-brand-400">{lang}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </section>

              {/* Internal Notes */}
              <section className="card !p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold"><StickyNote size={14} className="text-brand-400" /> Internal Notes</h2>
                <textarea
                  className="input-field mt-3 min-h-24 resize-y text-sm"
                  placeholder='"Strong candidate for the lead role..."'
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button
                  onClick={saveNote}
                  disabled={savingNote || note === (savedNote ?? "")}
                  className="btn-ghost mt-2 w-full justify-center !py-2 text-sm disabled:opacity-50"
                >
                  {savingNote ? "Saving..." : "Save note"}
                </button>
                <p className="mt-2 text-[10px] text-mist-600">Notes are private to you and saved with your shortlist.</p>
              </section>
            </div>

            {/* ===== العمود الأوسط ===== */}
            <div className="space-y-6">
              {/* الـ pipeline الحالي */}
              {applications.length > 0 && (
                <section className="card !p-5">
                  <h2 className="flex items-center gap-2 text-sm font-bold"><TrendingUp size={14} className="text-brand-400" /> In Your Pipeline</h2>
                  <div className="mt-3 space-y-2">
                    {applications.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-700/60 bg-ink-900/50 px-4 py-2.5">
                        <span className="text-sm font-semibold">{a.job.title}</span>
                        <select
                          value={a.stage}
                          onChange={(e) => setStage(a, e.target.value as Stage)}
                          className={"cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-semibold outline-none " + STAGE_META[a.stage].cls}
                          aria-label={`Stage for ${a.job.title}`}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s} className="bg-ink-800 text-mist-100">{STAGE_META[s].label}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Career Roadmap */}
              <section className="card">
                <h2 className="flex items-center gap-2 font-bold"><Clock size={15} className="text-brand-400" /> Career Roadmap</h2>
                {profile.experiences.length === 0 ? (
                  <p className="mt-3 text-sm text-mist-600">No work history listed.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {profile.experiences.map((e) => (
                      <div key={e.id} className="relative rounded-xl border border-ink-700/60 bg-ink-900/50 p-4 pl-5">
                        <span className={"absolute left-0 top-4 h-[calc(100%-2rem)] w-1 rounded-full " + (e.endYear === null ? "bg-brand-500" : "bg-ink-700")} />
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="font-bold">{e.title}</h3>
                          <span className="text-sm text-mist-600">{e.startYear} – {e.endYear ?? "Present"}</span>
                        </div>
                        <p className="mt-0.5 text-sm font-semibold text-brand-400">{e.company}</p>
                        {e.description && <p className="mt-2 text-sm leading-relaxed text-mist-400">{e.description}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Featured Projects */}
              <section className="card">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 font-bold"><TrendingUp size={15} className="text-brand-400" /> Featured Projects</h2>
                  {profile.githubUrl && (
                    <a href={profile.githubUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-cyan-400 hover:underline">
                      View GitHub Profile
                    </a>
                  )}
                </div>
                {projects.length === 0 ? (
                  <p className="mt-3 text-sm text-mist-600">No public projects.</p>
                ) : (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {[...projects].sort((a, b) => b.stars - a.stars).slice(0, 4).map((p) => (
                      <a key={p.name} href={p.url} target="_blank" rel="noreferrer" className="group rounded-xl border border-ink-700/60 bg-ink-900/50 p-4 transition-colors hover:border-brand-500/40">
                        <h3 className="font-bold group-hover:text-brand-400">{p.name}</h3>
                        {p.description && <p className="mt-1 line-clamp-2 text-sm text-mist-400">{p.description}</p>}
                        <div className="mt-3 flex items-center gap-3 text-xs text-mist-600">
                          <span className="inline-flex items-center gap-1"><StarIcon size={11} /> {fmt(p.stars)}</span>
                          {p.forks > 0 && <span className="inline-flex items-center gap-1"><GitFork size={11} /> {p.forks}</span>}
                          {p.language && <span>{p.language}</span>}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </section>

              {/* About */}
              {profile.bio && (
                <section className="card">
                  <h2 className="font-bold">About {profile.displayName?.split(" ")[0]}</h2>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-mist-400">{profile.bio}</p>
                </section>
              )}
            </div>

            {/* ===== العمود اليمين: Document Preview ===== */}
            <div className="space-y-6">
              <section className="card !p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold"><FileText size={14} className="text-brand-400" /> Document Preview</h2>
                {profile.resumeUrl ? (
                  <>
                    <a
                      href={profile.resumeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 flex items-center gap-2.5 rounded-xl border border-ink-700/60 bg-ink-900/60 px-3 py-2.5 hover:border-brand-500/40"
                    >
                      <FileText size={17} className="shrink-0 text-mist-400" />
                      <span className="truncate text-sm font-semibold">resume_{user.username}.pdf</span>
                    </a>
                    <iframe
                      src={profile.resumeUrl}
                      title="Resume preview"
                      className="mt-3 h-80 w-full rounded-xl border border-ink-700/60 bg-white"
                    />
                  </>
                ) : (
                  <p className="mt-3 text-sm text-mist-600">No resume uploaded by this candidate.</p>
                )}
              </section>

              <section className="card !p-5">
                <h2 className="text-sm font-bold">Candidate Snapshot</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-mist-600">Member since</dt><dd>{new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short" })}</dd></div>
                  <div className="flex justify-between"><dt className="text-mist-600">Specialty</dt><dd>{profile.specialty ?? "—"}</dd></div>
                  <div className="flex justify-between"><dt className="text-mist-600">Location</dt><dd>{profile.location ?? "—"}</dd></div>
                  <div className="flex justify-between"><dt className="text-mist-600">Skills listed</dt><dd>{profile.skills.length}</dd></div>
                  <div className="flex justify-between"><dt className="text-mist-600">Shortlisted</dt><dd>{shortlisted ? "Yes" : "No"}</dd></div>
                </dl>
              </section>
            </div>
          </div>

          {/* ===== شريط الأكشنز السفلي ===== */}
          <div className="sticky bottom-4 mt-8">
            <div className="card flex flex-wrap items-center justify-between gap-3 !px-5 !py-3 shadow-2xl">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand-500 text-sm font-bold text-white">
                  {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : profile.displayName?.[0]?.toUpperCase()}
                </span>
                <span>
                  <span className="block text-sm font-bold">{profile.displayName}</span>
                  <span className="text-xs text-mist-600">{profile.specialty ?? "Candidate"}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeApp && activeApp.stage !== "REJECTED" && (
                  <button
                    onClick={() => setStage(activeApp, "REJECTED")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10"
                  >
                    <XCircle size={15} /> Reject
                  </button>
                )}
                <button onClick={messageCandidate} disabled={startingChat} className="btn-ghost !py-2 text-sm disabled:opacity-60">
                  <MessageCircle size={15} /> {startingChat ? "Opening..." : "Message"}
                </button>
                <div className="relative">
                  <button
                    onClick={() => setPickJobOpen((o) => !o)}
                    disabled={busy}
                    className="btn-primary !py-2 text-sm disabled:opacity-60"
                  >
                    <CheckCircle2 size={15} /> Shortlist & Add to Pipeline
                  </button>
                  {pickJobOpen && (
                    <div className="absolute bottom-full right-0 z-20 mb-2 w-64 rounded-xl border border-ink-700 bg-ink-800 py-1.5 shadow-2xl">
                      <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-mist-600">Add to open role</p>
                      {myJobs.length === 0 && (
                        <p className="px-3 py-2 text-sm text-mist-400">
                          No open roles — <Link to="/jobs" className="font-semibold text-brand-400 hover:underline">post one first</Link>.
                        </p>
                      )}
                      {myJobs.map((j) => (
                        <button
                          key={j.id}
                          onClick={() => addToPipeline(j.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-900"
                        >
                          <Plus size={13} className="shrink-0 text-brand-400" />
                          <span className="min-w-0 flex-1 truncate">{j.title}</span>
                          {matchScore(j.skills, candidateSkillNames) !== null && (
                            <MatchScoreBar score={matchScore(j.skills, candidateSkillNames)} />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

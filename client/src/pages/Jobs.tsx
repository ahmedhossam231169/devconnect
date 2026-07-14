import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { AppShell } from "../components/AppShell";
import { STAGES, STAGE_META, MatchScoreBar, PostRoleModal, type Stage } from "./RecruiterDashboard";
import {
  Plus, MapPin, Clock, ChevronDown, ChevronUp, Trash2, UserPlus, Lock, Unlock,
} from "lucide-react";

// ---------------------------------------------------------------
// Jobs — إدارة الوظايف المفتوحة + الـ pipeline بتاع كل وظيفة
// ---------------------------------------------------------------

interface JobItem {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  employmentType: string | null;
  skills: string[];
  status: "OPEN" | "CLOSED";
  createdAt: string;
  candidateCount: number;
  stageCounts: Record<Stage, number>;
}

interface JobApplication {
  id: string;
  stage: Stage;
  matchScore: number | null;
  candidate: { username: string; displayName: string; avatarUrl: string | null; headline: string | null };
}

export default function Jobs() {
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPost, setShowPost] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [apps, setApps] = useState<Record<string, JobApplication[]>>({});
  const [addDraft, setAddDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ ok: true; jobs: JobItem[] }>("/api/jobs");
      setJobs(res.jobs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleExpand(job: JobItem) {
    if (openJob === job.id) { setOpenJob(null); return; }
    setOpenJob(job.id);
    setAddDraft("");
    setAddError(null);
    const res = await api<{ ok: true; applications: JobApplication[] }>(`/api/jobs/${job.id}/candidates`).catch(() => null);
    if (res) setApps((p) => ({ ...p, [job.id]: res.applications }));
  }

  async function addCandidate(job: JobItem) {
    setAddError(null);
    try {
      const res = await api<{ ok: true; application: JobApplication }>(`/api/jobs/${job.id}/candidates`, {
        method: "POST",
        body: JSON.stringify({ username: addDraft.trim() }),
      });
      setApps((p) => ({
        ...p,
        [job.id]: [res.application, ...(p[job.id] ?? []).filter((a) => a.id !== res.application.id)],
      }));
      setAddDraft("");
      load();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Couldn't add candidate");
    }
  }

  async function setStage(jobId: string, app: JobApplication, stage: Stage) {
    setApps((p) => ({ ...p, [jobId]: (p[jobId] ?? []).map((a) => (a.id === app.id ? { ...a, stage } : a)) }));
    await api(`/api/jobs/applications/${app.id}`, { method: "PATCH", body: JSON.stringify({ stage }) }).catch(() => {});
    load();
  }

  async function toggleStatus(job: JobItem) {
    const status = job.status === "OPEN" ? "CLOSED" : "OPEN";
    setJobs((p) => p.map((j) => (j.id === job.id ? { ...j, status } : j)));
    await api(`/api/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ status }) }).catch(() => load());
  }

  async function deleteJob(job: JobItem) {
    if (!window.confirm(`Delete "${job.title}" and its pipeline? This can't be undone.`)) return;
    setJobs((p) => p.filter((j) => j.id !== job.id));
    await api(`/api/jobs/${job.id}`, { method: "DELETE" }).catch(() => load());
  }

  return (
    <AppShell width="wide">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">Jobs</h1>
          <p className="mt-1 text-sm text-mist-400">Your open roles and their hiring pipelines.</p>
        </div>
        <button onClick={() => setShowPost(true)} className="btn-primary !py-2 text-sm">
          <Plus size={16} /> Post New Role
        </button>
      </div>

      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-ink-700/40" />)}
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="card !p-10 text-center">
          <p className="font-semibold">No roles posted yet</p>
          <p className="mt-1 text-sm text-mist-400">Post your first role to start building a pipeline.</p>
          <button onClick={() => setShowPost(true)} className="btn-primary mx-auto mt-4 !py-2 text-sm">
            <Plus size={16} /> Post New Role
          </button>
        </div>
      )}

      <div className="space-y-4">
        {jobs.map((job) => (
          <div key={job.id} className="card !p-0">
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold">{job.title}</h2>
                    <span
                      className={
                        "rounded-full px-2.5 py-0.5 text-[10px] font-bold " +
                        (job.status === "OPEN" ? "bg-emerald-500/15 text-emerald-400" : "bg-ink-700 text-mist-400")
                      }
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist-600">
                    {job.location && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {job.location}</span>}
                    {job.employmentType && <span>{job.employmentType}</span>}
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} /> Posted {new Date(job.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  {job.skills.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {job.skills.map((s) => (
                        <span key={s} className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-400">{s}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button onClick={() => toggleStatus(job)} className="rounded-lg p-2 text-mist-400 hover:bg-ink-900 hover:text-mist-100" title={job.status === "OPEN" ? "Close role" : "Reopen role"}>
                    {job.status === "OPEN" ? <Lock size={15} /> : <Unlock size={15} />}
                  </button>
                  <button onClick={() => deleteJob(job)} className="rounded-lg p-2 text-mist-400 hover:bg-ink-900 hover:text-red-400" title="Delete role">
                    <Trash2 size={15} />
                  </button>
                  <button onClick={() => toggleExpand(job)} className="btn-ghost !px-3 !py-2 text-sm">
                    {job.candidateCount} candidate{job.candidateCount === 1 ? "" : "s"}
                    {openJob === job.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                </div>
              </div>

              {/* شريط عدّادات المراحل */}
              {job.candidateCount > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                  {STAGES.filter((s) => job.stageCounts[s] > 0).map((s) => (
                    <span key={s} className="inline-flex items-center gap-1.5 text-xs text-mist-400">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_META[s].bar }} />
                      {STAGE_META[s].label} · {job.stageCounts[s]}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* الـ pipeline المتوسع */}
            {openJob === job.id && (
              <div className="border-t border-ink-700/60 bg-ink-900/40 p-5">
                <div className="mb-3 flex gap-2">
                  <div className="relative flex-1">
                    <UserPlus size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist-600" />
                    <input
                      className="input-field !py-2 !pl-10 text-sm"
                      placeholder="Add candidate by username (must be discoverable)..."
                      value={addDraft}
                      onChange={(e) => setAddDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addDraft.trim() && addCandidate(job)}
                    />
                  </div>
                  <button onClick={() => addCandidate(job)} disabled={!addDraft.trim()} className="btn-primary !py-2 text-sm disabled:opacity-50">
                    Add
                  </button>
                </div>
                {addError && <p className="mb-3 text-xs text-red-400">{addError}</p>}

                {(apps[job.id] ?? []).length === 0 ? (
                  <p className="py-3 text-center text-sm text-mist-600">
                    No candidates yet — add one above or from <Link to="/talent" className="font-semibold text-brand-400 hover:underline">Talent Search</Link>.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(apps[job.id] ?? []).map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700/60 bg-ink-800 px-4 py-2.5">
                        <Link to={`/talent/${a.candidate.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-500 text-xs font-bold text-white">
                            {a.candidate.avatarUrl ? <img src={a.candidate.avatarUrl} alt="" className="h-full w-full object-cover" /> : a.candidate.displayName[0]?.toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold hover:text-brand-400">{a.candidate.displayName}</span>
                            <span className="block truncate text-xs text-mist-600">{a.candidate.headline ?? `@${a.candidate.username}`}</span>
                          </span>
                        </Link>
                        <MatchScoreBar score={a.matchScore} />
                        <select
                          value={a.stage}
                          onChange={(e) => setStage(job.id, a, e.target.value as Stage)}
                          className={"cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-semibold outline-none " + STAGE_META[a.stage].cls}
                          aria-label={`Stage for ${a.candidate.displayName}`}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s} className="bg-ink-800 text-mist-100">{STAGE_META[s].label}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showPost && <PostRoleModal onClose={() => setShowPost(false)} onCreated={load} />}
    </AppShell>
  );
}

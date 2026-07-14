import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { AppShell } from "../components/AppShell";
import {
  Briefcase, Users, Clock, TrendingUp, Plus, X, Trash2, ExternalLink,
} from "lucide-react";

// ---------------------------------------------------------------
// Recruiter Dashboard — صفحة 9 في الديزاين
// KPIs + توزيع مراحل الـ pipeline + جدول الـ Talent Pool — كله داتا حقيقية
// ---------------------------------------------------------------

export const STAGES = ["SOURCED", "SCREENING", "INTERVIEW", "OFFERED", "HIRED", "REJECTED"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<Stage, { label: string; cls: string; bar: string }> = {
  SOURCED:   { label: "Sourced",              cls: "bg-slate-500/15 text-slate-300",     bar: "#64748b" },
  SCREENING: { label: "Screening",            cls: "bg-cyan-500/15 text-cyan-400",       bar: "#06b6d4" },
  INTERVIEW: { label: "Interviewing",         cls: "bg-amber-500/15 text-amber-400",     bar: "#f59e0b" },
  OFFERED:   { label: "Offered",              cls: "bg-emerald-500/15 text-emerald-400", bar: "#10b981" },
  HIRED:     { label: "Hired",                cls: "bg-brand-500/15 text-brand-400",     bar: "#6366f1" },
  REJECTED:  { label: "Rejected",             cls: "bg-red-500/15 text-red-400",         bar: "#ef4444" },
};

interface PipelineRow {
  id: string;
  stage: Stage;
  note: string | null;
  matchScore: number | null;
  candidate: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
    headline: string | null;
    specialty: string | null;
  };
  job: { id: string; title: string };
}

interface DashboardData {
  kpis: { openRoles: number; activeCandidates: number; avgTimeToHire: number | null; conversion: number | null };
  stageDistribution: Record<Stage, number>;
  pipeline: PipelineRow[];
}

export function MatchScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-mist-600">—</span>;
  const color = score >= 75 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-900">
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold" style={{ color }}>{score}%</span>
    </div>
  );
}

export function PostRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("Full-time");
  const [description, setDescription] = useState("");
  const [skillDraft, setSkillDraft] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addSkill() {
    const s = skillDraft.trim();
    if (!s || skills.some((x) => x.toLowerCase() === s.toLowerCase())) return;
    setSkills((p) => [...p, s]);
    setSkillDraft("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          title,
          location: location || undefined,
          employmentType: employmentType || undefined,
          description: description || undefined,
          skills,
        }),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form onSubmit={submit} className="card w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Post New Role</h2>
          <button type="button" onClick={onClose} className="text-mist-600 hover:text-mist-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <input className="input-field" placeholder="Role title (e.g. Senior React Developer)" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <input className="input-field" placeholder="Location (e.g. Remote)" value={location} onChange={(e) => setLocation(e.target.value)} />
          <select className="input-field" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
            {["Full-time", "Part-time", "Contract", "Freelance", "Internship"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <textarea className="input-field min-h-20 resize-y" placeholder="What will they build?" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div>
          <div className="flex gap-2">
            <input
              className="input-field !py-2 text-sm"
              placeholder="Required skill (e.g. React) — Enter to add"
              value={skillDraft}
              onChange={(e) => setSkillDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
            />
            <button type="button" onClick={addSkill} className="btn-ghost !py-2 text-sm">Add</button>
          </div>
          {skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span key={s} className="flex items-center gap-1 rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-semibold text-brand-400">
                  {s}
                  <button type="button" onClick={() => setSkills((p) => p.filter((x) => x !== s))} aria-label={`Remove ${s}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-xs text-mist-600">Match scores are computed from these skills.</p>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={saving || !title.trim()} className="btn-primary w-full justify-center disabled:opacity-50">
          {saving ? "Posting..." : "Post Role"}
        </button>
      </form>
    </div>
  );
}

export default function RecruiterDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPost, setShowPost] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ ok: true } & DashboardData>("/api/jobs/dashboard");
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setStage(row: PipelineRow, stage: Stage) {
    setData((d) => d && ({
      ...d,
      pipeline: d.pipeline.map((r) => (r.id === row.id ? { ...r, stage } : r)),
    }));
    await api(`/api/jobs/applications/${row.id}`, { method: "PATCH", body: JSON.stringify({ stage }) }).catch(() => load());
  }

  async function removeRow(row: PipelineRow) {
    if (!window.confirm(`Remove ${row.candidate.displayName} from "${row.job.title}"?`)) return;
    setData((d) => d && ({ ...d, pipeline: d.pipeline.filter((r) => r.id !== row.id) }));
    await api(`/api/jobs/applications/${row.id}`, { method: "DELETE" }).catch(() => load());
  }

  const totalInPipeline = data ? Object.values(data.stageDistribution).reduce((a, b) => a + b, 0) : 0;

  const kpi = (icon: React.ReactNode, label: string, value: string, sub?: string) => (
    <div className="card !p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-mist-600">{label}</p>
        <span className="text-brand-400">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-extrabold">{value}</p>
      {sub && <p className="mt-1 text-xs text-mist-600">{sub}</p>}
    </div>
  );

  return (
    <AppShell width="wide">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">Recruitment Dashboard</h1>
          <p className="mt-1 text-sm text-mist-400">Track your roles, pipeline, and top candidates.</p>
        </div>
        <button onClick={() => setShowPost(true)} className="btn-primary !py-2 text-sm">
          <Plus size={16} /> Post New Role
        </button>
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-ink-700/40" />)}
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpi(<Briefcase size={17} />, "Open Roles", String(data.kpis.openRoles))}
            {kpi(<Users size={17} />, "Active Candidates", String(data.kpis.activeCandidates))}
            {kpi(<Clock size={17} />, "Avg. Time to Hire", data.kpis.avgTimeToHire !== null ? `${data.kpis.avgTimeToHire}d` : "—", data.kpis.avgTimeToHire === null ? "No hires yet" : undefined)}
            {kpi(<TrendingUp size={17} />, "Pipeline Conversion", data.kpis.conversion !== null ? `${data.kpis.conversion}%` : "—", data.kpis.conversion === null ? "No candidates yet" : "Reached offer or hire")}
          </div>

          {/* توزيع المراحل */}
          {totalInPipeline > 0 && (
            <div className="card mt-6 !p-5">
              <h2 className="text-sm font-bold">Pipeline Stages</h2>
              <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-ink-900">
                {STAGES.map((s) =>
                  data.stageDistribution[s] > 0 ? (
                    <div
                      key={s}
                      title={`${STAGE_META[s].label}: ${data.stageDistribution[s]}`}
                      style={{ width: `${(data.stageDistribution[s] / totalInPipeline) * 100}%`, backgroundColor: STAGE_META[s].bar }}
                    />
                  ) : null
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {STAGES.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5 text-xs text-mist-400">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_META[s].bar }} />
                    {STAGE_META[s].label} · {data.stageDistribution[s]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* جدول الـ Talent Pool */}
          <div className="card mt-6 overflow-hidden !p-0">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="font-bold">Talent Pool</h2>
              <Link to="/talent" className="text-sm font-semibold text-brand-400 hover:underline">
                Find more candidates
              </Link>
            </div>

            {data.pipeline.length === 0 ? (
              <div className="border-t border-ink-700/60 p-8 text-center text-sm text-mist-400">
                No candidates in your pipeline yet — post a role, then add candidates from{" "}
                <Link to="/talent" className="font-semibold text-brand-400 hover:underline">Talent Search</Link>.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-t border-ink-700/60 bg-ink-900/50 text-[10px] uppercase tracking-wider text-mist-600">
                      <th className="px-5 py-2.5 font-bold">Candidate</th>
                      <th className="px-4 py-2.5 font-bold">Role</th>
                      <th className="px-4 py-2.5 font-bold">Match Score</th>
                      <th className="px-4 py-2.5 font-bold">Status</th>
                      <th className="px-4 py-2.5 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700/40">
                    {data.pipeline.map((row) => (
                      <tr key={row.id} className="hover:bg-ink-900/40">
                        <td className="px-5 py-3">
                          <Link to={`/talent/${row.candidate.username}`} className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-500 text-sm font-bold text-white">
                              {row.candidate.avatarUrl ? (
                                <img src={row.candidate.avatarUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                row.candidate.displayName[0]?.toUpperCase()
                              )}
                            </span>
                            <span>
                              <span className="block font-semibold hover:text-brand-400">{row.candidate.displayName}</span>
                              <span className="text-xs text-mist-600">{row.candidate.specialty ?? row.candidate.headline ?? `@${row.candidate.username}`}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-mist-400">{row.job.title}</td>
                        <td className="px-4 py-3"><MatchScoreBar score={row.matchScore} /></td>
                        <td className="px-4 py-3">
                          <select
                            value={row.stage}
                            onChange={(e) => setStage(row, e.target.value as Stage)}
                            className={"cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-semibold outline-none " + STAGE_META[row.stage].cls}
                            aria-label={`Stage for ${row.candidate.displayName}`}
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s} className="bg-ink-800 text-mist-100">
                                {STAGE_META[s].label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Link to={`/talent/${row.candidate.username}`} className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-800 hover:text-brand-400" title="View candidate">
                              <ExternalLink size={15} />
                            </Link>
                            <button onClick={() => removeRow(row)} className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-800 hover:text-red-400" title="Remove from pipeline">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showPost && <PostRoleModal onClose={() => setShowPost(false)} onCreated={load} />}
    </AppShell>
  );
}

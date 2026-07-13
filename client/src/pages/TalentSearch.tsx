import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { SPECIALTIES, type Candidate, type Specialty, type Availability } from "../lib/types";
import { AppShell } from "../components/AppShell";

interface Filters {
  q: string;
  specialty: Specialty | "";
  availability: Availability | "";
  minYears: string;
  skills: string[];
}

const EMPTY_FILTERS: Filters = { q: "", specialty: "", availability: "", minYears: "", skills: [] };

export default function TalentSearch() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [skillDraft, setSkillDraft] = useState("");
  const [allSkills, setAllSkills] = useState<string[]>([]);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api<{ ok: true; skills: string[] }>("/api/talent/facets")
      .then((res) => setAllSkills(res.skills))
      .catch(() => {});
  }, []);

  const buildQuery = useCallback((f: Filters, cursor?: string) => {
    const params = new URLSearchParams();
    if (f.q) params.set("q", f.q);
    if (f.specialty) params.set("specialty", f.specialty);
    if (f.availability) params.set("availability", f.availability);
    if (f.minYears) params.set("minYears", f.minYears);
    f.skills.forEach((s) => params.append("skills", s));
    params.set("take", "9");
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, []);

  const search = useCallback(
    async (f: Filters) => {
      setLoading(true);
      try {
        const res = await api<{ ok: true; candidates: Candidate[]; nextCursor: string | null }>(
          `/api/talent/search?${buildQuery(f)}`
        );
        setCandidates(res.candidates);
        setNextCursor(res.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [buildQuery]
  );

  useEffect(() => {
    search(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(e?: React.FormEvent) {
    e?.preventDefault();
    search(filters);
  }

  function toggleSkill(name: string) {
    setFilters((f) => ({
      ...f,
      skills: f.skills.includes(name) ? f.skills.filter((s) => s !== name) : [...f.skills, name],
    }));
  }

  function addSkillFromDraft() {
    const s = skillDraft.trim();
    if (!s || filters.skills.includes(s)) return;
    setFilters((f) => ({ ...f, skills: [...f.skills, s] }));
    setSkillDraft("");
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await api<{ ok: true; candidates: Candidate[]; nextCursor: string | null }>(
        `/api/talent/search?${buildQuery(filters, nextCursor)}`
      );
      setCandidates((c) => [...c, ...res.candidates]);
      setNextCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <AppShell width="wide">
        <h1 className="mb-1 text-2xl font-bold">Talent Search</h1>
        <p className="mb-6 text-sm text-mist-400">Filter the developer pool by role, experience, and stack.</p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          {/* ---- Filters sidebar ---- */}
          <form onSubmit={applyFilters} className="card h-fit space-y-4 !p-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Search</label>
              <input
                className="input-field !py-2 text-sm"
                placeholder="Name or username..."
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Specialty</label>
              <select
                className="input-field !py-2 text-sm"
                value={filters.specialty}
                onChange={(e) => setFilters((f) => ({ ...f, specialty: e.target.value as Specialty | "" }))}
              >
                <option value="">Any</option>
                {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Availability</label>
              <select
                className="input-field !py-2 text-sm"
                value={filters.availability}
                onChange={(e) => setFilters((f) => ({ ...f, availability: e.target.value as Availability | "" }))}
              >
                <option value="">Any</option>
                <option value="OPEN_TO_WORK">Open to work</option>
                <option value="FREELANCE_ONLY">Freelance only</option>
                <option value="NOT_LOOKING">Not looking</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Min. years experience</label>
              <input
                type="number"
                min={0}
                max={60}
                className="input-field !py-2 text-sm"
                value={filters.minYears}
                onChange={(e) => setFilters((f) => ({ ...f, minYears: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Skills (must have all)</label>
              <div className="mb-2 flex gap-2">
                <input
                  className="input-field !py-2 text-sm"
                  placeholder="Add a skill..."
                  value={skillDraft}
                  onChange={(e) => setSkillDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkillFromDraft())}
                  list="known-skills"
                />
                <datalist id="known-skills">
                  {allSkills.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              {filters.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {filters.skills.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => toggleSkill(s)}
                      className="flex items-center gap-1 rounded-full bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-brand-400"
                    >
                      {s} ×
                    </button>
                  ))}
                </div>
              )}
              {allSkills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {allSkills.filter((s) => !filters.skills.includes(s)).slice(0, 6).map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => toggleSkill(s)}
                      className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-mist-400 hover:border-brand-500 hover:text-brand-400"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary flex-1 justify-center !py-2 text-sm">
                Apply
              </button>
              <button
                type="button"
                onClick={() => { setFilters(EMPTY_FILTERS); search(EMPTY_FILTERS); }}
                className="btn-ghost !py-2 text-sm"
              >
                Reset
              </button>
            </div>
          </form>

          {/* ---- Results ---- */}
          <div>
            {loading && <p className="py-8 text-center text-sm text-mist-400">Searching...</p>}

            {!loading && candidates.length === 0 && (
              <div className="card !p-8 text-center">
                <p className="font-semibold">No candidates match these filters</p>
                <p className="mt-1 text-sm text-mist-400">Try loosening a filter or two.</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {candidates.map((c) => (
                <Link
                  key={c.id}
                  to={`/talent/${c.username}`}
                  className="card !p-4 transition-colors hover:border-brand-500/50"
                >
                  <div className="mb-2 flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-700 font-bold">
                      {c.displayName?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.displayName}</p>
                      <p className="truncate text-xs text-mist-400">@{c.username}</p>
                    </div>
                    {c.availability === "OPEN_TO_WORK" && (
                      <span className="ml-auto shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        Open
                      </span>
                    )}
                  </div>
                  {c.headline && <p className="mb-2 truncate text-sm text-mist-400">{c.headline}</p>}
                  <div className="mb-2 flex flex-wrap gap-1.5 text-xs text-mist-400">
                    {c.specialty && <span className="rounded-full border border-ink-700 px-2 py-0.5">{c.specialty}</span>}
                    {c.yearsExperience !== null && (
                      <span className="rounded-full border border-ink-700 px-2 py-0.5">{c.yearsExperience}y exp</span>
                    )}
                    {c.location && <span className="rounded-full border border-ink-700 px-2 py-0.5">{c.location}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.skills.slice(0, 4).map((s) => (
                      <span key={s.name} className="rounded bg-ink-900 px-1.5 py-0.5 text-[11px] text-brand-400">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>

            {nextCursor && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="btn-ghost mt-4 w-full justify-center text-sm disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        </div>
      </AppShell>
    </>
  );
}

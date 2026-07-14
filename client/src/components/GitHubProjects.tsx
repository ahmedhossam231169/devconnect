import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { GitHubProject, GitHubStats } from "../lib/types";
import { Star, GitFork, BookMarked, Users } from "lucide-react";

const LANG_COLOR: Record<string, string> = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", Rust: "#dea584",
  Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d", "C#": "#178600", PHP: "#4F5D95",
  Ruby: "#701516", Swift: "#F05138", Kotlin: "#A97BFF", HTML: "#e34c26", CSS: "#563d7c",
};

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);

// ---- خانة إحصائية صغيرة في شريط الـ GitHub Stats ----
function StatTile({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-xl border border-ink-700/60 bg-ink-800/60 px-4 py-3">
      <div className="flex items-center gap-1.5 text-brand-400">
        {icon}
        <span className="text-lg font-extrabold text-mist-100">{value}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-mist-600">{label}</p>
    </div>
  );
}

export function GitHubProjects({
  username,
  fallback = null,
}: {
  username: string;
  /** بيتعرض لو مفيش GitHub متربط (بدل ما القسم يختفي) — زي فورم الربط في صفحة Projects */
  fallback?: ReactNode;
}) {
  const [projects, setProjects] = useState<GitHubProject[]>([]);
  const [stats, setStats] = useState<GitHubStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    api<{ ok: true; projects: GitHubProject[]; stats: GitHubStats | null; githubConnected: boolean }>(
      `/api/profiles/${username}/github-projects`
    )
      .then((r) => {
        setProjects(r.projects);
        setStats(r.stats);
        setConnected(r.githubConnected);
      })
      .catch(() => setConnected(false))
      .finally(() => setLoading(false));
  }, [username]);

  if (loading) return <p className="py-4 text-center text-sm text-mist-400">Loading projects...</p>;

  // مفيش GitHub متربط — نعرض الـ fallback (فورم الربط / رسالة)
  if (!connected) return <>{fallback}</>;

  // متربط بس مفيش مشاريع عامة — رسالة واضحة بدل صفحة فاضية
  if (projects.length === 0) {
    return (
      <div className="card !p-8 text-center">
        <p className="font-semibold">No public repositories yet</p>
        <p className="mt-1 text-sm text-mist-400">
          {stats ? `@${stats.username} is connected — ` : ""}public repos will show up here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* GitHub Stats — أرقام مجمّعة من الحساب */}
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={<BookMarked size={15} />} value={fmt(stats.publicRepos)} label="Public Repos" />
          <StatTile icon={<Star size={15} />} value={fmt(stats.totalStars)} label="Total Stars" />
          <StatTile icon={<GitFork size={15} />} value={fmt(stats.totalForks)} label="Total Forks" />
          <StatTile icon={<Users size={15} />} value={fmt(stats.followers)} label="Followers" />
          {stats.topLanguages.length > 0 && (
            <div className="col-span-2 flex flex-wrap items-center gap-2 rounded-xl border border-ink-700/60 bg-ink-800/60 px-4 py-3 sm:col-span-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-brand-400">Top Languages</span>
              {stats.topLanguages.map((l) => (
                <span key={l.name} className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 px-2.5 py-0.5 text-xs font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LANG_COLOR[l.name] ?? "#888" }} />
                  {l.name}
                  <span className="font-normal text-mist-600">×{l.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <h2 className="mb-3 flex items-center gap-2 font-semibold">
         GitHub Projects
        <span className="text-xs font-normal text-mist-600">
          · live from GitHub{stats && (
            <>
              {" "}·{" "}
              <a href={`https://github.com/${stats.username}`} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
                @{stats.username}
              </a>
            </>
          )}
        </span>
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <a
            key={p.name}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="card !p-4 transition-colors hover:border-brand-500/50"
          >
            <div className="flex items-center justify-between">
              <h3 className="truncate font-semibold text-brand-400">{p.name}</h3>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-mist-400"><Star size={12} /> {p.stars}</span>
            </div>
            {p.description && <p className="mt-1 line-clamp-2 text-sm text-mist-400">{p.description}</p>}
            {p.language && (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-mist-400">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: LANG_COLOR[p.language] ?? "#888" }} />
                {p.language}
                {p.forks > 0 && <span className="ml-2 inline-flex items-center gap-1"><GitFork size={12} /> {p.forks}</span>}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

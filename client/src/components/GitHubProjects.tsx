import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { GitHubProject } from "../lib/types";

const LANG_COLOR: Record<string, string> = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", Rust: "#dea584",
  Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d", "C#": "#178600", PHP: "#4F5D95",
  Ruby: "#701516", Swift: "#F05138", Kotlin: "#A97BFF", HTML: "#e34c26", CSS: "#563d7c",
};

export function GitHubProjects({ username }: { username: string }) {
  const [projects, setProjects] = useState<GitHubProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    api<{ ok: true; projects: GitHubProject[]; githubConnected: boolean }>(
      `/api/profiles/${username}/github-projects`
    )
      .then((r) => {
        setProjects(r.projects);
        setConnected(r.githubConnected);
      })
      .catch(() => setConnected(false))
      .finally(() => setLoading(false));
  }, [username]);

  if (loading) return <p className="py-4 text-center text-sm text-mist-400">Loading projects...</p>;

  // مفيش GitHub متربط أو مفيش مشاريع — ما نعرضش القسم أصلاً
  if (!connected || projects.length === 0) return null;

  return (
    <div className="mt-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
         GitHub Projects
        <span className="text-xs font-normal text-mist-600">· live from GitHub</span>
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
              <span className="shrink-0 text-xs text-mist-400">⭐ {p.stars}</span>
            </div>
            {p.description && <p className="mt-1 line-clamp-2 text-sm text-mist-400">{p.description}</p>}
            {p.language && (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-mist-400">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: LANG_COLOR[p.language] ?? "#888" }} />
                {p.language}
                {p.forks > 0 && <span className="ml-2">🍴 {p.forks}</span>}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, Zap, Flame, Terminal } from "lucide-react";
import { api } from "../lib/api";

// ---------------------------------------------------------------
// ويدجتات الفيد — كل الداتا من /api/feed/sidebar (طلب واحد)
// Trending Tech / Rising Stars / Active Hubs + YOUR PROFILE STATS
// ---------------------------------------------------------------

interface Trend { tag: string; count: number; changePct: number }
interface Star { username: string; displayName: string; avatarUrl: string | null; headline: string | null }
interface Hub { name: string; slug: string; category: string; isPrivate: boolean; memberCount: number; postsThisWeek: number }
export interface SidebarData {
  trending: Trend[];
  risingStars: Star[];
  activeHubs: Hub[];
  myStats: { profileViews: number; upvotes: number };
}

export function useFeedSidebar() {
  const [data, setData] = useState<SidebarData | null>(null);
  useEffect(() => {
    api<{ ok: true } & SidebarData>("/api/feed/sidebar")
      .then((r) => setData(r))
      .catch(() => {});
  }, []);
  return data;
}

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);

// ---- YOUR PROFILE STATS — بيتحط في الـ sidebar الشمال ----
export function ProfileStatsWidget({ stats }: { stats: SidebarData["myStats"] | undefined }) {
  if (!stats) return null;
  return (
    <div className="rounded-xl border border-ink-700/60 bg-ink-800/60 p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-400">
        Your Profile Stats
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xl font-extrabold">{fmt(stats.profileViews)}</p>
          <p className="text-[11px] text-mist-600">Profile Views</p>
        </div>
        <div>
          <p className="text-xl font-extrabold">{fmt(stats.upvotes)}</p>
          <p className="text-[11px] text-mist-600">Upvotes</p>
        </div>
      </div>
    </div>
  );
}

// ---- زرار Follow صغير (Rising Stars) ----
function FollowButton({ username }: { username: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  async function follow() {
    setState("busy");
    try {
      await api(`/api/friends/follow/${username}`, { method: "POST" });
      setState("done");
    } catch {
      setState("idle");
    }
  }
  return (
    <button
      onClick={follow}
      disabled={state !== "idle"}
      className={
        "rounded-lg px-3 py-1 text-xs font-semibold transition-colors " +
        (state === "done"
          ? "bg-brand-500/15 text-brand-400"
          : "border border-ink-700 text-mist-100 hover:bg-ink-700/50 disabled:opacity-60")
      }
    >
      {state === "done" ? "Following" : "Follow"}
    </button>
  );
}

// ---- العمود اليمين بالكامل ----
export function FeedSidebar({ data }: { data: SidebarData | null }) {
  return (
    <div className="space-y-4">
      {/* Trending Tech */}
      <section className="card !p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <TrendingUp size={15} className="text-brand-400" /> TRENDING TECH
        </h2>
        <div className="mt-4 space-y-4">
          {!data && <WidgetSkeleton rows={4} />}
          {data && data.trending.length === 0 && (
            <p className="text-sm text-mist-600">No trends yet this week.</p>
          )}
          {data?.trending.map((t) => (
            <div key={t.tag} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">#{t.tag}</p>
                <p className="text-xs text-mist-600">
                  {fmt(t.count)} {t.count === 1 ? "post" : "posts"} this week
                </p>
              </div>
              <span
                className={
                  "rounded-md px-1.5 py-0.5 text-xs font-bold " +
                  (t.changePct >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")
                }
              >
                {t.changePct >= 0 ? "+" : ""}{t.changePct}%
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Rising Stars */}
      <section className="card !p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Zap size={15} className="text-brand-400" /> RISING STARS
        </h2>
        <div className="mt-4 space-y-3.5">
          {!data && <WidgetSkeleton rows={3} />}
          {data && data.risingStars.length === 0 && (
            <p className="text-sm text-mist-600">No suggestions right now.</p>
          )}
          {data?.risingStars.map((s) => (
            <div key={s.username} className="flex items-center gap-3">
              <Link to={`/u/${s.username}`} className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-500 text-sm font-bold text-white">
                {s.avatarUrl ? <img src={s.avatarUrl} alt="" className="h-full w-full object-cover" /> : s.displayName[0]?.toUpperCase()}
              </Link>
              <div className="min-w-0 flex-1">
                <Link to={`/u/${s.username}`} className="block truncate text-sm font-semibold hover:text-brand-400">
                  {s.displayName}
                </Link>
                {s.headline && <p className="truncate text-xs text-mist-600">{s.headline}</p>}
              </div>
              <FollowButton username={s.username} />
            </div>
          ))}
        </div>
      </section>

      {/* Active Hubs */}
      <section className="card !p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Flame size={15} className="text-brand-400" /> ACTIVE HUBS
        </h2>
        <div className="mt-4 space-y-3.5">
          {!data && <WidgetSkeleton rows={2} />}
          {data && data.activeHubs.length === 0 && (
            <p className="text-sm text-mist-600">No communities yet.</p>
          )}
          {data?.activeHubs.map((h) => (
            <Link key={h.slug} to={`/communities/${h.slug}`} className="group flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-mist-400">
                <Terminal size={16} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold group-hover:text-brand-400">{h.name}</p>
                <p className="text-xs text-mist-600">{fmt(h.memberCount)} members</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <p className="px-1 text-[11px] leading-relaxed text-mist-600">
        ABOUT · PRIVACY · TERMS · COOKIE POLICY
        <br />© {new Date().getFullYear()} DEVCONNECT
      </p>
    </div>
  );
}

function WidgetSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-lg bg-ink-700/40" />
      ))}
    </div>
  );
}

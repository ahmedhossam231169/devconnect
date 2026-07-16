import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Users, FileText, User, Lock, Search as SearchIcon } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { api } from "../lib/api";

interface SearchUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  specialty: string | null;
}
interface SearchPost {
  id: string;
  title: string | null;
  excerpt: string;
  authorName: string;
  authorUsername: string;
}
interface SearchCommunity {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  avatarUrl: string | null;
  isPrivate: boolean;
  memberCount: number;
  joinedByMe: boolean;
}

type Tab = "all" | "people" | "posts" | "communities";

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);

export default function SearchResults() {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();

  const [users, setUsers] = useState<SearchUser[]>([]);
  const [posts, setPosts] = useState<SearchPost[]>([]);
  const [communities, setCommunities] = useState<SearchCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    if (q.length < 2) {
      setUsers([]);
      setPosts([]);
      setCommunities([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api<{ ok: true; users: SearchUser[]; posts: SearchPost[]; communities: SearchCommunity[] }>(
      `/api/search?q=${encodeURIComponent(q)}`
    )
      .then((res) => {
        if (!alive) return;
        setUsers(res.users);
        setPosts(res.posts);
        setCommunities(res.communities ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setUsers([]);
        setPosts([]);
        setCommunities([]);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q]);

  const total = users.length + posts.length + communities.length;
  const showPeople = tab === "all" || tab === "people";
  const showPosts = tab === "all" || tab === "posts";
  const showCommunities = tab === "all" || tab === "communities";

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    { key: "people", label: "People", count: users.length },
    { key: "posts", label: "Posts", count: posts.length },
    { key: "communities", label: "Communities", count: communities.length },
  ];

  return (
    <AppShell width="wide">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold sm:text-2xl">
          {q ? <>Results for “{q}”</> : "Search"}
        </h1>
        {q && !loading && (
          <p className="mt-1 text-sm text-mist-400">
            {total} {total === 1 ? "result" : "results"} found
          </p>
        )}
      </div>

      {/* تبويبات الفلتر — People / Posts / Communities */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors " +
              (tab === t.key
                ? "bg-brand-500 text-white"
                : "border border-ink-700 text-mist-400 hover:text-mist-100")
            }
          >
            {t.label} <span className="opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      {q.length < 2 && (
        <div className="card !p-10 text-center">
          <SearchIcon size={28} className="mx-auto mb-3 text-mist-600" />
          <p className="font-semibold">Type at least 2 characters to search</p>
          <p className="mt-1 text-sm text-mist-400">Search across developers, posts, and communities.</p>
        </div>
      )}

      {q.length >= 2 && loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink-700/40" />
          ))}
        </div>
      )}

      {q.length >= 2 && !loading && total === 0 && (
        <div className="card !p-10 text-center">
          <p className="font-semibold">No results for “{q}”</p>
          <p className="mt-1 text-sm text-mist-400">Try a different keyword or check the spelling.</p>
        </div>
      )}

      {q.length >= 2 && !loading && total > 0 && (
        <div className="space-y-8">
          {/* ===== People ===== */}
          {showPeople && users.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-mist-600">
                <User size={15} /> People
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {users.map((u) => (
                  <Link
                    key={u.username}
                    to={`/u/${u.username}`}
                    className="card flex items-center gap-3 !p-4 transition-colors hover:border-brand-500/50"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-500 font-bold text-white">
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        u.displayName[0]?.toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{u.displayName}</p>
                      <p className="truncate text-xs text-mist-600">
                        {u.headline ?? `@${u.username}`}
                      </p>
                    </div>
                    {u.specialty && (
                      <span className="shrink-0 rounded-full bg-ink-900 px-2.5 py-1 text-xs text-brand-400">
                        {u.specialty}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ===== Posts ===== */}
          {showPosts && posts.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-mist-600">
                <FileText size={15} /> Posts
              </h2>
              <div className="space-y-3">
                {posts.map((p) => (
                  <Link
                    key={p.id}
                    to={`/post/${p.id}`}
                    className="card block !p-4 transition-colors hover:border-brand-500/50"
                  >
                    <p className="font-semibold">{p.title ?? p.excerpt}</p>
                    {p.title && <p className="mt-1 line-clamp-2 text-sm text-mist-400">{p.excerpt}</p>}
                    <p className="mt-2 text-xs text-mist-600">by {p.authorName}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ===== Communities ===== */}
          {showCommunities && communities.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-mist-600">
                <Users size={15} /> Communities
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {communities.map((c) => (
                  <Link
                    key={c.id}
                    to={`/communities/${c.slug}`}
                    className="card flex items-center gap-3 !p-4 transition-colors hover:border-brand-500/50"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-900 text-brand-400">
                      {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Users size={20} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-semibold">
                        {c.name}
                        {c.isPrivate && <Lock size={12} className="shrink-0 text-mist-600" />}
                      </p>
                      <p className="truncate text-xs text-mist-600">
                        {c.category} · {fmt(c.memberCount)} members
                      </p>
                    </div>
                    {c.joinedByMe && (
                      <span className="shrink-0 rounded-full bg-ink-900 px-2.5 py-1 text-xs text-brand-400">
                        Joined
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* لو الفلتر المختار مفيهوش نتايج بس فيه نتايج في تبويبات تانية */}
          {((tab === "people" && users.length === 0) ||
            (tab === "posts" && posts.length === 0) ||
            (tab === "communities" && communities.length === 0)) && (
            <div className="card !p-10 text-center">
              <p className="font-semibold">No {tab} match “{q}”</p>
              <p className="mt-1 text-sm text-mist-400">Try the “All” tab to see other results.</p>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

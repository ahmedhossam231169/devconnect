import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { COMMUNITY_CATEGORIES, type CommunityCategory, type CommunityListItem } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { Users, Atom, Cog, Brain, Server, Smartphone, BarChart3, Hexagon } from "lucide-react";

const CATEGORY_ICONS: Record<string, typeof Atom> = {
  Frontend: Atom, Backend: Cog, "AI & ML": Brain, DevOps: Server, Mobile: Smartphone, Data: BarChart3,
};

function CatIcon({ category, size = 26 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICONS[category] ?? Hexagon;
  return <Icon size={size} />;
}

export default function Communities() {
  const [communities, setCommunities] = useState<CommunityListItem[]>([]);
  const [category, setCategory] = useState<CommunityCategory | "All">("All");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [newCategory, setNewCategory] = useState<CommunityCategory>("Frontend");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (cat: CommunityCategory | "All") => {
    setLoading(true);
    try {
      const qs = cat === "All" ? "" : `?category=${encodeURIComponent(cat)}`;
      const res = await api<{ ok: true; communities: CommunityListItem[] }>(`/api/communities${qs}`);
      setCommunities(res.communities);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(category);
  }, [category, load]);

  async function toggleJoin(c: CommunityListItem) {
    // optimistic update
    setCommunities((list) =>
      list.map((x) =>
        x.slug === c.slug
          ? { ...x, joinedByMe: !x.joinedByMe, memberCount: x.memberCount + (x.joinedByMe ? -1 : 1) }
          : x
      )
    );
    try {
      const res = await api<{ ok: true; joined: boolean; memberCount: number }>(
        `/api/communities/${c.slug}/join`,
        { method: "POST" }
      );
      setCommunities((list) =>
        list.map((x) => (x.slug === c.slug ? { ...x, joinedByMe: res.joined, memberCount: res.memberCount } : x))
      );
    } catch {
      load(category); // rollback بسيط: نعيد التحميل لو فشل
    }
  }

  async function createCommunity(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await api("/api/communities", {
        method: "POST",
        body: JSON.stringify({ name, description: description || undefined, category: newCategory }),
      });
      setName("");
      setDescription("");
      setShowCreate(false);
      await load(category);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create community");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <AppShell width="wide">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Communities Hub</h1>
            <p className="mt-1 text-sm text-mist-400">
              Discover and join specialized circles of engineers pushing the boundaries of technology.
            </p>
          </div>
          <button onClick={() => setShowCreate((s) => !s)} className="btn-primary shrink-0 !py-2 text-sm">
            + Create Community
          </button>
        </div>

        {showCreate && (
          <form onSubmit={createCommunity} className="card mb-6 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                className="input-field"
                placeholder="Community name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <select
                className="input-field"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as CommunityCategory)}
              >
                {COMMUNITY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <textarea
              className="input-field min-h-20 resize-y"
              placeholder="What's this community about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {createError && <p className="text-sm text-red-400">{createError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={creating || !name.trim()} className="btn-primary !py-2 text-sm disabled:opacity-50">
                {creating ? "Creating..." : "Create"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost !py-2 text-sm">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* فلتر الفئات */}
        <div className="mb-6 flex flex-wrap gap-2">
          {(["All", ...COMMUNITY_CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors " +
                (category === c ? "bg-brand-500 text-white" : "border border-ink-700 text-mist-400 hover:text-mist-100")
              }
            >
              {c === "All" ? "All Communities" : c}
            </button>
          ))}
        </div>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading communities...</p>}

        {!loading && communities.length === 0 && (
          <div className="card !p-8 text-center">
            <p className="font-semibold">No communities in this category yet</p>
            <p className="mt-1 text-sm text-mist-400">Be the first to start one.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {communities.map((c) => (
            <div key={c.id} className="card !p-4">
              <Link to={`/communities/${c.slug}`} className="mb-3 flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/30 to-ink-700 text-brand-400" aria-label={`${c.name} community`}>
                <CatIcon category={c.category} />
              </Link>
              <Link to={`/communities/${c.slug}`} className="font-bold hover:underline">{c.name}</Link>
              <p className="mt-1 line-clamp-2 text-sm text-mist-400">{c.description}</p>
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-mist-600"><Users size={12} /> {c.memberCount} members</p>
              <div className="mt-3 flex gap-2">
                <Link to={`/communities/${c.slug}`} className="btn-ghost flex-1 justify-center !py-2 text-sm">View</Link>
                <button
                  onClick={() => toggleJoin(c)}
                  className={
                    "flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors " +
                    (c.joinedByMe
                      ? "border border-ink-700 text-mist-100 hover:bg-ink-900"
                      : "bg-brand-500 text-white hover:bg-brand-600")
                  }
                >
                  {c.joinedByMe ? "Joined" : "Join"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </AppShell>
    </>
  );
}

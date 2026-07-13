import { Link } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { COMMUNITY_CATEGORIES, type CommunityCategory, type CommunityListItem } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { ImageUpload } from "../components/ImageUpload";
import {
  Users, Atom, Cog, Brain, Server, Smartphone, BarChart3, Hexagon,
  Search, TrendingUp, Lock, Plus, X,
} from "lucide-react";

const CATEGORY_ICONS: Record<string, typeof Atom> = {
  Frontend: Atom, Backend: Cog, "AI & ML": Brain, DevOps: Server, Mobile: Smartphone, Data: BarChart3,
};

// تدرجات الغلاف الافتراضية لكل فئة (بديل صورة الغلاف)
const CATEGORY_GRADIENTS: Record<string, string> = {
  Frontend: "linear-gradient(120deg, #1e3a5f, #0e7490)",
  Backend: "linear-gradient(120deg, #7c2d12, #b45309)",
  "AI & ML": "linear-gradient(120deg, #14532d, #0d9488)",
  DevOps: "linear-gradient(120deg, #1e3a8a, #4338ca)",
  Mobile: "linear-gradient(120deg, #581c87, #7c3aed)",
  Data: "linear-gradient(120deg, #713f12, #ca8a04)",
};

function CatIcon({ category, size = 22 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICONS[category] ?? Hexagon;
  return <Icon size={size} />;
}

// بادج مستوى النشاط — محسوب من بوستات آخر أسبوع
function activityLabel(postsThisWeek: number): { label: string; cls: string } {
  if (postsThisWeek >= 10) return { label: "High Activity", cls: "text-emerald-400" };
  if (postsThisWeek >= 3) return { label: "Growing Fast", cls: "text-cyan-400" };
  if (postsThisWeek >= 1) return { label: "Active", cls: "text-brand-400" };
  return { label: "Quiet", cls: "text-mist-600" };
}

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);

export default function Communities() {
  const [communities, setCommunities] = useState<CommunityListItem[]>([]);
  const [category, setCategory] = useState<CommunityCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [newCategory, setNewCategory] = useState<CommunityCategory>("Frontend");
  const [newAvatarUrl, setNewAvatarUrl] = useState<string | null>(null);
  const [newCoverUrl, setNewCoverUrl] = useState<string | null>(null);
  const [newIsPrivate, setNewIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (cat: CommunityCategory | "All", q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (cat !== "All") params.set("category", cat);
      if (q.trim()) params.set("q", q.trim());
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await api<{ ok: true; communities: CommunityListItem[] }>(`/api/communities${qs}`);
      setCommunities(res.communities);
    } finally {
      setLoading(false);
    }
  }, []);

  // بحث مع debounce بسيط
  useEffect(() => {
    const t = setTimeout(() => load(category, query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [category, query, load]);

  async function toggleJoin(c: CommunityListItem) {
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
      load(category, query);
    }
  }

  async function createCommunity(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await api("/api/communities", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: description || undefined,
          category: newCategory,
          avatarUrl: newAvatarUrl ?? undefined,
          coverUrl: newCoverUrl ?? undefined,
          isPrivate: newIsPrivate,
        }),
      });
      setName("");
      setDescription("");
      setNewAvatarUrl(null);
      setNewCoverUrl(null);
      setNewIsPrivate(false);
      setShowCreate(false);
      await load(category, query);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create community");
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell width="wide">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">Communities Hub</h1>
          <p className="mt-1 max-w-lg text-sm text-mist-400">
            Discover and join specialized circles of engineers pushing the boundaries of technology.
          </p>
        </div>
        <button onClick={() => setShowCreate((s) => !s)} className="btn-primary shrink-0 !py-2 text-sm">
          <Plus size={16} /> Create Community
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createCommunity} className="card mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">New Community</h2>
            <button type="button" onClick={() => setShowCreate(false)} className="text-mist-600 hover:text-mist-100" aria-label="Close">
              <X size={18} />
            </button>
          </div>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium">Logo</label>
              <ImageUpload currentUrl={newAvatarUrl} onUploaded={setNewAvatarUrl} label="Upload logo" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Cover image</label>
              <ImageUpload currentUrl={newCoverUrl} onUploaded={setNewCoverUrl} label="Upload cover" rounded={false} />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              checked={newIsPrivate}
              onChange={(e) => setNewIsPrivate(e.target.checked)}
              className="h-4 w-4 accent-brand-500"
            />
            Private community — joining requires admin approval
          </label>
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

      {/* فلتر الفئات + البحث — زي الديزاين */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
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
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist-600" />
          <input
            className="input-field !py-2 !pl-10 text-sm"
            placeholder="Search by name or keyword..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search communities"
          />
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-ink-700/40" />
          ))}
        </div>
      )}

      {!loading && communities.length === 0 && (
        <div className="card !p-8 text-center">
          <p className="font-semibold">No communities found</p>
          <p className="mt-1 text-sm text-mist-400">
            {query ? "Try a different search." : "Be the first to start one."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {communities.map((c) => {
          const act = activityLabel(c.postsThisWeek);
          return (
            <div key={c.id} className="card group overflow-hidden !p-0">
              {/* الغلاف */}
              <Link
                to={`/communities/${c.slug}`}
                className="block h-28 w-full"
                style={
                  c.coverUrl
                    ? { backgroundImage: `url(${c.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : { background: CATEGORY_GRADIENTS[c.category] ?? "linear-gradient(120deg, #312e81, #4338ca)" }
                }
                aria-label={`${c.name} community`}
              />
              <div className="p-5">
                {/* اللوجو متداخل مع الغلاف */}
                <div className="-mt-12 mb-3 flex items-end justify-between">
                  <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-4 border-ink-800 bg-ink-900 text-brand-400">
                    {c.avatarUrl ? (
                      <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <CatIcon category={c.category} />
                    )}
                  </span>
                  {c.isPrivate && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10px] font-bold text-mist-400">
                      <Lock size={10} /> PRIVATE
                    </span>
                  )}
                </div>

                <Link to={`/communities/${c.slug}`} className="text-lg font-bold hover:text-brand-400">
                  {c.name}
                </Link>
                <p className="mt-1 line-clamp-2 min-h-10 text-sm text-mist-400">{c.description}</p>

                <div className="mt-3 flex items-center gap-4 text-xs">
                  <span className="inline-flex items-center gap-1 text-mist-400">
                    <Users size={12} /> {fmt(c.memberCount)} Members
                  </span>
                  <span className={"inline-flex items-center gap-1 font-semibold " + act.cls}>
                    <TrendingUp size={12} /> {act.label}
                  </span>
                </div>

                <div className="mt-4 flex gap-2">
                  <Link to={`/communities/${c.slug}`} className="btn-ghost flex-1 justify-center !py-2 text-sm">
                    Explore Community
                  </Link>
                  <button
                    onClick={() => toggleJoin(c)}
                    className={
                      "rounded-lg px-4 py-2 text-sm font-semibold transition-colors " +
                      (c.joinedByMe
                        ? "border border-ink-700 text-mist-100 hover:bg-ink-900"
                        : "bg-brand-500 text-white hover:bg-brand-600")
                    }
                  >
                    {c.joinedByMe ? "Joined" : "Join"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

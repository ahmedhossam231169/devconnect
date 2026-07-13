import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { PAGE_CATEGORIES, type PageCategory, type PageListItem } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { Building2, Rocket, Globe, Users, Package, FileText, Plus } from "lucide-react";

const CATEGORY_ICON: Record<string, typeof Building2> = {
  Company: Building2, Project: Rocket, "Open Source": Globe, Community: Users, Product: Package,
};

function CategoryIcon({ category, size = 22 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICON[category] ?? FileText;
  return <Icon size={size} />;
}

export default function Pages() {
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [category, setCategory] = useState<PageCategory>("Company");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ ok: true; pages: PageListItem[] }>("/api/pages");
      setPages(res.pages);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleFollow(p: PageListItem) {
    setPages((list) =>
      list.map((x) =>
        x.slug === p.slug
          ? { ...x, followedByMe: !x.followedByMe, followerCount: x.followerCount + (x.followedByMe ? -1 : 1) }
          : x
      )
    );
    try {
      const res = await api<{ ok: true; following: boolean; followerCount: number }>(
        `/api/pages/${p.slug}/follow`,
        { method: "POST" }
      );
      setPages((list) =>
        list.map((x) => (x.slug === p.slug ? { ...x, followedByMe: res.following, followerCount: res.followerCount } : x))
      );
    } catch {
      load();
    }
  }

  async function createPage(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await api("/api/pages", {
        method: "POST",
        body: JSON.stringify({ name, bio: bio || undefined, category }),
      });
      setName("");
      setBio("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create page");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <AppShell width="default">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Pages</h1>
            <p className="mt-1 text-sm text-mist-400">
              Follow companies, projects, and open-source teams — or create your own.
            </p>
          </div>
          <button onClick={() => setShowCreate((s) => !s)} className="btn-primary shrink-0 !py-2 text-sm">
            <Plus size={16} /> Create Page
          </button>
        </div>

        {showCreate && (
          <form onSubmit={createPage} className="card mb-6 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input className="input-field" placeholder="Page name" value={name} onChange={(e) => setName(e.target.value)} required />
              <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value as PageCategory)}>
                {PAGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <textarea className="input-field min-h-20 resize-y" placeholder="What's this page about?" value={bio} onChange={(e) => setBio(e.target.value)} />
            {createError && <p className="text-sm text-red-400">{createError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={creating || !name.trim()} className="btn-primary !py-2 text-sm disabled:opacity-50">
                {creating ? "Creating..." : "Create"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost !py-2 text-sm">Cancel</button>
            </div>
          </form>
        )}

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading pages...</p>}

        {!loading && pages.length === 0 && (
          <div className="card !p-8 text-center">
            <p className="font-semibold">No pages yet</p>
            <p className="mt-1 text-sm text-mist-400">Be the first to create one.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {pages.map((p) => (
            <div key={p.id} className="card !p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-500/30 to-ink-700 text-2xl">
                  {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" /> : <CategoryIcon category={p.category} />}
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/pages/${p.slug}`} className="font-bold hover:underline">{p.name}</Link>
                  <p className="text-xs text-mist-600">{p.category} · {p.followerCount} followers</p>
                  {p.bio && <p className="mt-1 line-clamp-2 text-sm text-mist-400">{p.bio}</p>}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Link to={`/pages/${p.slug}`} className="btn-ghost flex-1 justify-center !py-1.5 text-sm">View</Link>
                <button
                  onClick={() => toggleFollow(p)}
                  className={
                    "flex-1 rounded-lg px-4 py-1.5 text-sm font-semibold " +
                    (p.followedByMe ? "border border-ink-700 hover:bg-ink-900" : "bg-brand-500 text-white hover:bg-brand-600")
                  }
                >
                  {p.followedByMe ? "Following" : "Follow"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </AppShell>
    </>
  );
}

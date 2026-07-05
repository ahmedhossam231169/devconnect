import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { PageDetail as PageDetailType, Post } from "../lib/types";
import { Navbar } from "../components/Navbar";
import { Building2, Rocket, Globe, Users, Package, FileText, ArrowLeft } from "lucide-react";
import { Composer } from "../components/Composer";
import { PostCard } from "../components/PostCard";

const CATEGORY_ICON: Record<string, typeof Building2> = {
  Company: Building2, Project: Rocket, "Open Source": Globe, Community: Users, Product: Package,
};

function CategoryIcon({ category, size = 30 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICON[category] ?? FileText;
  return <Icon size={size} />;
}

export default function PageDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<PageDetailType | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!slug) return;
    api<{ ok: true; page: PageDetailType; posts: Post[] }>(`/api/pages/${slug}`)
      .then((res) => {
        setPage(res.page);
        setPosts(res.posts);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  async function toggleFollow() {
    if (!page) return;
    setToggling(true);
    try {
      const res = await api<{ ok: true; following: boolean; followerCount: number }>(
        `/api/pages/${page.slug}/follow`,
        { method: "POST" }
      );
      setPage((p) => (p ? { ...p, followedByMe: res.following, followerCount: res.followerCount } : p));
    } finally {
      setToggling(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Link to="/pages" className="mb-4 inline-flex items-center gap-1.5 text-sm text-mist-400 hover:text-mist-100">
          <ArrowLeft size={15} /> Back to Pages
        </Link>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading...</p>}

        {!loading && page && (
          <>
            <div className="card mb-4">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-500/30 to-ink-700 text-3xl">
                  {page.avatarUrl ? <img src={page.avatarUrl} alt="" className="h-full w-full object-cover" /> : <CategoryIcon category={page.category} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold">{page.name}</h1>
                    {page.isAdmin && (
                      <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-400">Admin</span>
                    )}
                  </div>
                  <p className="text-sm text-mist-600">{page.category} · {page.followerCount} followers</p>
                  {page.bio && <p className="mt-2 text-sm text-mist-100">{page.bio}</p>}
                </div>
                <button
                  onClick={toggleFollow}
                  disabled={toggling}
                  className={
                    "shrink-0 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 " +
                    (page.followedByMe ? "border border-ink-700 hover:bg-ink-900" : "bg-brand-500 text-white hover:bg-brand-600")
                  }
                >
                  {toggling ? "..." : page.followedByMe ? "Following" : "Follow"}
                </button>
              </div>
            </div>

            {/* Admin composer — بينشر باسم الصفحة */}
            {page.isAdmin && (
              <div className="mb-4">
                <Composer
                  endpoint={`/api/pages/${page.slug}/posts`}
                  placeholder={`Post as ${page.name}...`}
                  onCreated={(post) => setPosts((p) => [post, ...p])}
                />
              </div>
            )}

            <h2 className="mb-3 px-1 font-semibold">
              Posts {posts.length > 0 && <span className="text-mist-600">({posts.length})</span>}
            </h2>
            {posts.length === 0 ? (
              <div className="card !p-8 text-center">
                <p className="text-sm text-mist-400">
                  {page.isAdmin ? "Share your first update above." : "This page hasn't posted yet."}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {posts.map((p) => (
                  <PostCard key={p.id} post={p} onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

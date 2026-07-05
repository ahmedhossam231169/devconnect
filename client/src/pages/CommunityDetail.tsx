import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { CommunityDetail as CommunityDetailType, Post } from "../lib/types";
import { Navbar } from "../components/Navbar";
import { Composer } from "../components/Composer";
import { PostCard } from "../components/PostCard";

export default function CommunityDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [community, setCommunity] = useState<CommunityDetailType | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!slug) return;
    Promise.all([
      api<{ ok: true; community: CommunityDetailType }>(`/api/communities/${slug}`),
      api<{ ok: true; posts: Post[] }>(`/api/communities/${slug}/posts`),
    ])
      .then(([c, p]) => {
        setCommunity(c.community);
        setPosts(p.posts);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  async function toggleJoin() {
    if (!community) return;
    setToggling(true);
    try {
      const res = await api<{ ok: true; joined: boolean; memberCount: number }>(
        `/api/communities/${community.slug}/join`,
        { method: "POST" }
      );
      setCommunity((c) => (c ? { ...c, joinedByMe: res.joined, memberCount: res.memberCount } : c));
    } finally {
      setToggling(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Link to="/communities" className="mb-4 inline-block text-sm text-mist-400 hover:text-mist-100">
          ← Back to Communities
        </Link>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading...</p>}

        {!loading && community && (
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">{community.name}</h1>
                <p className="mt-1 text-sm text-mist-400">{community.category} · {community.memberCount} members</p>
              </div>
              <button
                onClick={toggleJoin}
                disabled={toggling}
                className={
                  "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 " +
                  (community.joinedByMe ? "border border-ink-700 hover:bg-ink-900" : "bg-brand-500 text-white hover:bg-brand-600")
                }
              >
                {toggling ? "..." : community.joinedByMe ? "Joined ✓" : "Join Community"}
              </button>
            </div>

            {community.description && <p className="mt-4 text-mist-100">{community.description}</p>}

            <div className="mt-6 border-t border-ink-700 pt-4">
              <h2 className="mb-3 font-semibold">Members</h2>
              <div className="space-y-2">
                {community.memberPreview.map((m) => (
                  <div key={m.username} className="flex items-center gap-2.5 text-sm">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 font-bold">
                      {m.displayName[0]?.toUpperCase()}
                    </div>
                    <span>{m.displayName}</span>
                    <span className="text-mist-600">@{m.username}</span>
                    {m.role === "ADMIN" && (
                      <span className="ml-auto rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-400">
                        Admin
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Community feed */}
        {!loading && community && (
          <div className="mt-6">
            {community.joinedByMe ? (
              <div className="mb-4">
                <Composer
                  endpoint={`/api/communities/${community.slug}/posts`}
                  placeholder={`Share something with ${community.name}...`}
                  onCreated={(post) => setPosts((p) => [post, ...p])}
                />
              </div>
            ) : (
              <div className="card mb-4 !p-4 text-center text-sm text-mist-400">
                Join the community to post here.
              </div>
            )}

            <h2 className="mb-3 px-1 font-semibold">
              Posts {posts.length > 0 && <span className="text-mist-600">({posts.length})</span>}
            </h2>
            {posts.length === 0 ? (
              <div className="card !p-8 text-center">
                <p className="text-sm text-mist-400">No posts yet. Be the first to share!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {posts.map((p) => (
                  <PostCard key={p.id} post={p} onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}

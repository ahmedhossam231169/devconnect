import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { CommunityDetail as CommunityDetailType, Post } from "../lib/types";
import { Navbar } from "../components/Navbar";
import { ArrowLeft, Settings, Users as UsersIcon, X } from "lucide-react";
import { Composer } from "../components/Composer";
import { PostCard } from "../components/PostCard";

export default function CommunityDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [community, setCommunity] = useState<CommunityDetailType | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [members, setMembers] = useState<{ username: string; role: string; profile: { displayName: string; avatarUrl: string | null } }[]>([]);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  async function openSettings() {
    if (!community) return;
    setEditName(community.name);
    setEditDesc(community.description ?? "");
    setShowSettings(true);
    const res = await api<{ ok: true; members: any[] }>(`/api/communities/${community.slug}/members`).catch(() => null);
    if (res) setMembers(res.members);
  }

  async function saveSettings() {
    if (!community) return;
    setSavingSettings(true);
    try {
      const res = await api<{ ok: true; community: { name: string; description: string | null } }>(
        `/api/communities/${community.slug}`,
        { method: "PATCH", body: JSON.stringify({ name: editName, description: editDesc }) }
      );
      setCommunity((c) => (c ? { ...c, name: res.community.name, description: res.community.description } : c));
      setShowSettings(false);
    } finally {
      setSavingSettings(false);
    }
  }

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
        <Link to="/communities" className="mb-4 inline-flex items-center gap-1.5 text-sm text-mist-400 hover:text-mist-100">
          <ArrowLeft size={15} /> Back to Communities
        </Link>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading...</p>}

        {!loading && community && (
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">{community.name}</h1>
                <p className="mt-1 text-sm text-mist-400">{community.category} · {community.memberCount} members</p>
              </div>
              <div className="flex items-center gap-2">
              {community.joinedByMe && (
                <button onClick={openSettings} className="flex items-center justify-center rounded-lg border border-ink-700 p-2 text-mist-400 hover:bg-ink-900" title="Community settings" aria-label="Settings">
                  <Settings size={17} />
                </button>
              )}
              <button
                onClick={toggleJoin}
                disabled={toggling}
                className={
                  "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 " +
                  (community.joinedByMe ? "border border-ink-700 hover:bg-ink-900" : "bg-brand-500 text-white hover:bg-brand-600")
                }
              >
                {toggling ? "..." : community.joinedByMe ? "Joined" : "Join Community"}
              </button>
              </div>
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

        {/* Settings panel */}
        {showSettings && community && (
          <div className="card mt-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><Settings size={17} /> Community Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-mist-400 hover:text-mist-100" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <input className="input-field" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Description</label>
                <textarea className="input-field min-h-20 resize-y" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
              </div>
              <button onClick={saveSettings} disabled={savingSettings || !editName.trim()} className="btn-primary !py-2 text-sm disabled:opacity-50">
                {savingSettings ? "Saving..." : "Save changes"}
              </button>
              <p className="text-xs text-mist-600">Only community admins can save changes.</p>
            </div>

            <div className="mt-5 border-t border-ink-700 pt-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><UsersIcon size={15} /> Members ({members.length})</h3>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {members.map((m) => (
                  <Link key={m.username} to={`/u/${m.username}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-900">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-sm font-bold">
                      {m.profile.avatarUrl ? <img src={m.profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : m.profile.displayName[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm">{m.profile.displayName}</span>
                    {m.role === "ADMIN" && <span className="ml-auto rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-400">Admin</span>}
                  </Link>
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

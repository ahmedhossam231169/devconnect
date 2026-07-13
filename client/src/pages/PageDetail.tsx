import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { PageDetail as PageDetailType, Post } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { Building2, Rocket, Globe, Users, Package, FileText, ArrowLeft, Settings, X, Camera, ShieldPlus, ShieldMinus, UserPlus, Trash2 } from "lucide-react";
import { Composer } from "../components/Composer";
import { PostCard } from "../components/PostCard";
import { FriendPicker } from "../components/FriendPicker";

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

  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [followers, setFollowers] = useState<any[]>([]);
  const [newAdmin, setNewAdmin] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  async function openSettings() {
    if (!page) return;
    setEditName(page.name);
    setEditBio(page.bio ?? "");
    setShowSettings(true);
    const res = await api<{ ok: true; followers: any[] }>(`/api/pages/${page.slug}/followers`).catch(() => null);
    if (res) setFollowers(res.followers);
  }

  async function deletePage() {
    if (!page) return;
    if (!confirm(`Delete "${page.name}" permanently? All its posts will be deleted too. This can't be undone.`)) return;
    try {
      await api(`/api/pages/${page.slug}`, { method: "DELETE" });
      window.location.href = "/pages";
    } catch (e: any) {
      alert(e?.message ?? "Couldn't delete the page");
    }
  }

  async function saveSettings(avatarUrl?: string) {
    if (!page) return;
    setSaving(true);
    try {
      const res = await api<{ ok: true; page: any }>(`/api/pages/${page.slug}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName, bio: editBio, ...(avatarUrl !== undefined ? { avatarUrl } : {}) }),
      });
      setPage((p) => (p ? { ...p, name: res.page.name, bio: res.page.bio, avatarUrl: res.page.avatarUrl } : p));
      if (avatarUrl === undefined) setShowSettings(false);
    } finally {
      setSaving(false);
    }
  }

  async function uploadPageAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const CN = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const UP = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!CN || !UP) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", UP);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CN}/image/upload`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.secure_url) await saveSettings(data.secure_url);
  }

  async function toggleAdmin(username: string, isAdmin: boolean) {
    if (!page) return;
    if (isAdmin) await api(`/api/pages/${page.slug}/admins/${username}`, { method: "DELETE" }).catch(() => {});
    else await api(`/api/pages/${page.slug}/admins`, { method: "POST", body: JSON.stringify({ username }) }).catch(() => {});
    const res = await api<{ ok: true; followers: any[] }>(`/api/pages/${page.slug}/followers`).catch(() => null);
    if (res) setFollowers(res.followers);
  }

  async function addAdminByName() {
    if (!newAdmin.trim()) return;
    await toggleAdmin(newAdmin.trim(), false);
    setNewAdmin("");
  }

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
    <AppShell width="narrow">
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
                <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => setInviteOpen((o) => !o)} className="flex items-center justify-center rounded-lg border border-ink-700 p-2 text-mist-400 hover:bg-ink-900" title="Invite a friend to follow" aria-label="Invite a friend">
                  <UserPlus size={17} />
                </button>
                {page.isAdmin && (
                  <button onClick={openSettings} className="flex items-center justify-center rounded-lg border border-ink-700 p-2 text-mist-400 hover:bg-ink-900" title="Page settings" aria-label="Page settings">
                    <Settings size={17} />
                  </button>
                )}
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

              {inviteOpen && (
                <FriendPicker
                  title={`Invite a friend to follow ${page.name}`}
                  message={`Check out the ${page.name} page on DevConnect — follow it for updates 👇\n${window.location.origin}/pages/${page.slug}`}
                  onClose={() => setInviteOpen(false)}
                />
              )}
            </div>

            {/* Settings panel */}
            {showSettings && (
              <div className="card mb-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 font-semibold"><Settings size={17} /> Page Settings</h2>
                  <button onClick={() => setShowSettings(false)} className="text-mist-400 hover:text-mist-100" aria-label="Close"><X size={18} /></button>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1">
                      <label className="mb-1 block text-sm font-medium">Page name</label>
                      <input className="input-field" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2.5 text-sm text-mist-400 hover:bg-ink-900">
                      <Camera size={15} /> Change photo
                      <input type="file" accept="image/*" className="hidden" onChange={uploadPageAvatar} />
                    </label>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Bio</label>
                    <textarea className="input-field min-h-20 resize-y" value={editBio} onChange={(e) => setEditBio(e.target.value)} />
                  </div>
                  <button onClick={() => saveSettings()} disabled={saving || !editName.trim()} className="btn-primary !py-2 text-sm disabled:opacity-50">
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </div>

                <div className="mt-5 border-t border-ink-700 pt-4">
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Users size={15} /> Followers ({followers.length})</h3>
                  <div className="mb-3 flex gap-2">
                    <input className="input-field !py-2 text-sm" placeholder="username to add as admin" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} />
                    <button onClick={addAdminByName} disabled={!newAdmin.trim()} className="btn-ghost shrink-0 !py-2 text-sm disabled:opacity-50">
                      <ShieldPlus size={15} /> Add admin
                    </button>
                  </div>
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {followers.map((f: any) => (
                      <div key={f.username} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-900">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-sm font-bold">
                          {f.profile?.avatarUrl ? <img src={f.profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : f.profile?.displayName?.[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm">{f.profile?.displayName}</span>
                        <span className="text-xs text-mist-600">@{f.username}</span>
                        {f.isAdmin && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-400">Admin</span>}
                        <button
                          onClick={() => toggleAdmin(f.username, f.isAdmin)}
                          className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-mist-400 hover:bg-ink-800 hover:text-mist-100"
                          title={f.isAdmin ? "Remove admin" : "Make admin"}
                        >
                          {f.isAdmin ? <ShieldMinus size={13} /> : <ShieldPlus size={13} />}
                          {f.isAdmin ? "Remove admin" : "Make admin"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 border-t border-red-500/20 pt-4">
                  <h3 className="mb-2 text-sm font-semibold text-red-400">Danger zone</h3>
                  <button
                    onClick={deletePage}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 size={14} /> Delete page permanently
                  </button>
                </div>
              </div>
            )}

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
                  <PostCard
                    key={p.id}
                    post={p}
                    canModerate={page.isAdmin}
                    onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
                    onPinToggled={(id, pinned) =>
                      setPosts((prev) =>
                        [...prev]
                          .map((x) => (x.id === id ? { ...x, pinned } : x))
                          .sort(
                            (a, b) =>
                              Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
                              +new Date(b.createdAt) - +new Date(a.createdAt)
                          )
                      )
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
    </AppShell>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { CommunityDetail as CommunityDetailType, Post, JoinRequest } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { ArrowLeft, Settings, Users as UsersIcon, X, UserMinus, UserPlus, Shield, ShieldOff, Lock, Check, Trash2 } from "lucide-react";
import { Composer } from "../components/Composer";
import { PostCard } from "../components/PostCard";
import { FriendPicker } from "../components/FriendPicker";

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
  const [editAdminOnly, setEditAdminOnly] = useState(false);
  const [editPrivate, setEditPrivate] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [requests, setRequests] = useState<JoinRequest[]>([]);

  const isAdmin = community?.myRole === "ADMIN";

  async function changeRole(username: string, role: "ADMIN" | "MEMBER") {
    if (!community) return;
    try {
      await api(`/api/communities/${community.slug}/members/${username}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setMembers((prev) => prev.map((m) => (m.username === username ? { ...m, role } : m)));
    } catch (e: any) {
      alert(e?.message ?? "Couldn't change the role");
    }
  }

  async function respondToRequest(username: string, accept: boolean) {
    if (!community) return;
    try {
      await api(`/api/communities/${community.slug}/requests/${username}`, {
        method: "POST",
        body: JSON.stringify({ accept }),
      });
      setRequests((prev) => prev.filter((r) => r.username !== username));
      if (accept) setCommunity((c) => (c ? { ...c, memberCount: c.memberCount + 1 } : c));
    } catch (e: any) {
      alert(e?.message ?? "Couldn't respond to the request");
    }
  }

  async function deleteCommunity() {
    if (!community) return;
    if (!confirm(`Delete "${community.name}" permanently? All its posts will be deleted too. This can't be undone.`)) return;
    try {
      await api(`/api/communities/${community.slug}`, { method: "DELETE" });
      window.location.href = "/communities";
    } catch (e: any) {
      alert(e?.message ?? "Couldn't delete the community");
    }
  }

  async function openSettings() {
    if (!community) return;
    setEditName(community.name);
    setEditDesc(community.description ?? "");
    setEditAdminOnly(community.adminOnlyPosting);
    setEditPrivate(community.isPrivate);
    setShowSettings(true);
    const [membersRes, requestsRes] = await Promise.all([
      api<{ ok: true; members: any[] }>(`/api/communities/${community.slug}/members`).catch(() => null),
      api<{ ok: true; requests: JoinRequest[] }>(`/api/communities/${community.slug}/requests`).catch(() => null),
    ]);
    if (membersRes) setMembers(membersRes.members);
    if (requestsRes) setRequests(requestsRes.requests);
  }

  async function removeMember(username: string) {
    if (!community || !confirm(`Remove @${username} from the community?`)) return;
    await api(`/api/communities/${community.slug}/members/${username}`, { method: "DELETE" }).catch(() => {});
    setMembers((prev) => prev.filter((m) => m.username !== username));
    setCommunity((c) => (c ? { ...c, memberCount: Math.max(0, c.memberCount - 1) } : c));
  }

  async function saveSettings() {
    if (!community) return;
    setSavingSettings(true);
    try {
      const res = await api<{ ok: true; community: { name: string; description: string | null; adminOnlyPosting: boolean; isPrivate: boolean } }>(
        `/api/communities/${community.slug}`,
        { method: "PATCH", body: JSON.stringify({ name: editName, description: editDesc, adminOnlyPosting: editAdminOnly, isPrivate: editPrivate }) }
      );
      setCommunity((c) =>
        c
          ? {
              ...c,
              name: res.community.name,
              description: res.community.description,
              adminOnlyPosting: res.community.adminOnlyPosting,
              isPrivate: res.community.isPrivate,
            }
          : c
      );
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
      const res = await api<{ ok: true; joined: boolean; requested?: boolean; memberCount?: number }>(
        `/api/communities/${community.slug}/join`,
        { method: "POST" }
      );
      setCommunity((c) =>
        c
          ? {
              ...c,
              joinedByMe: res.joined,
              requestedByMe: res.requested ?? false,
              memberCount: res.memberCount ?? c.memberCount,
            }
          : c
      );
    } finally {
      setToggling(false);
    }
  }

  return (
    <>
      <AppShell width="default">
        <Link to="/communities" className="mb-4 inline-flex items-center gap-1.5 text-sm text-mist-400 hover:text-mist-100">
          <ArrowLeft size={15} /> Back to Communities
        </Link>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading...</p>}

        {!loading && community && (
          <div className="card overflow-hidden !p-0">
            {/* غلاف الكوميونتي — صورة أو تدرج حسب الديزاين الجديد */}
            <div
              className="h-28 w-full"
              style={
                community.coverUrl
                  ? { backgroundImage: `url(${community.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : { background: "linear-gradient(120deg, #312e81, #4338ca)" }
              }
            />
            <div className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="-mt-14 flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-ink-800 bg-ink-900 text-xl font-bold text-brand-400">
                  {community.avatarUrl ? (
                    <img src={community.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    community.name[0]?.toUpperCase()
                  )}
                </span>
                <div>
                  <h1 className="flex items-center gap-2 text-2xl font-bold">
                    {community.name}
                    {community.isPrivate && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900 px-2.5 py-1 text-xs font-semibold text-mist-400">
                        <Lock size={11} /> Private
                      </span>
                    )}
                  </h1>
                  <p className="mt-1 text-sm text-mist-400">{community.category} · {community.memberCount} members</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
              {community.joinedByMe && (
                <button onClick={() => setInviteOpen((o) => !o)} className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-sm text-mist-400 hover:bg-ink-900" title="Invite a friend">
                  <UserPlus size={15} /> Invite
                </button>
              )}
              {isAdmin && (
                <button onClick={openSettings} className="flex items-center justify-center rounded-lg border border-ink-700 p-2 text-mist-400 hover:bg-ink-900" title="Community settings" aria-label="Settings">
                  <Settings size={17} />
                </button>
              )}
              <button
                onClick={toggleJoin}
                disabled={toggling}
                className={
                  "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 " +
                  (community.joinedByMe || community.requestedByMe
                    ? "border border-ink-700 hover:bg-ink-900"
                    : "bg-brand-500 text-white hover:bg-brand-600")
                }
              >
                {toggling
                  ? "..."
                  : community.joinedByMe
                    ? "Joined"
                    : community.requestedByMe
                      ? "Requested ✓"
                      : community.isPrivate
                        ? "Request to join"
                        : "Join Community"}
              </button>
              </div>
            </div>

            {inviteOpen && (
              <FriendPicker
                title={`Invite a friend to ${community.name}`}
                message={`Join me in the ${community.name} community on DevConnect 👇\n${window.location.origin}/communities/${community.slug}`}
                onClose={() => setInviteOpen(false)}
              />
            )}

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
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-700 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={editAdminOnly}
                  onChange={(e) => setEditAdminOnly(e.target.checked)}
                  className="h-4 w-4 accent-brand-500"
                />
                <span className="text-sm">
                  <span className="font-medium">Only admins can post</span>
                  <span className="block text-xs text-mist-600">Blog mode — members can read, react and comment, but not post</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-700 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={editPrivate}
                  onChange={(e) => setEditPrivate(e.target.checked)}
                  className="h-4 w-4 accent-brand-500"
                />
                <span className="text-sm">
                  <span className="font-medium">Private community</span>
                  <span className="block text-xs text-mist-600">Joining requires admin approval, and posts are visible to members only</span>
                </span>
              </label>
              <button onClick={saveSettings} disabled={savingSettings || !editName.trim()} className="btn-primary !py-2 text-sm disabled:opacity-50">
                {savingSettings ? "Saving..." : "Save changes"}
              </button>
              <p className="text-xs text-mist-600">Only community admins can save changes.</p>
            </div>

            {requests.length > 0 && (
              <div className="mt-5 border-t border-ink-700 pt-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <UserPlus size={15} /> Join requests ({requests.length})
                </h3>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {requests.map((r) => (
                    <div key={r.username} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-900">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-sm font-bold">
                        {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" /> : r.displayName[0]?.toUpperCase()}
                      </div>
                      <Link to={`/u/${r.username}`} className="text-sm hover:underline">{r.displayName}</Link>
                      <span className="ml-auto flex items-center gap-1.5">
                        <button
                          onClick={() => respondToRequest(r.username, true)}
                          className="flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-600"
                        >
                          <Check size={13} /> Accept
                        </button>
                        <button
                          onClick={() => respondToRequest(r.username, false)}
                          className="flex items-center gap-1 rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-mist-400 hover:bg-ink-800 hover:text-red-400"
                        >
                          <X size={13} /> Decline
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 border-t border-ink-700 pt-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><UsersIcon size={15} /> Members ({members.length})</h3>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {members.map((m) => (
                  <Link key={m.username} to={`/u/${m.username}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-900">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-sm font-bold">
                      {m.profile.avatarUrl ? <img src={m.profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : m.profile.displayName[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm">{m.profile.displayName}</span>
                    {m.role === "ADMIN" && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-400">Admin</span>}
                    <span className="ml-auto flex items-center gap-1">
                      {m.role === "ADMIN" ? (
                        <button
                          onClick={(e) => { e.preventDefault(); changeRole(m.username, "MEMBER"); }}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-mist-400 hover:bg-ink-800 hover:text-amber-400"
                          title="Demote to member"
                        >
                          <ShieldOff size={13} /> Demote
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.preventDefault(); changeRole(m.username, "ADMIN"); }}
                            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-mist-400 hover:bg-ink-800 hover:text-brand-400"
                            title="Make admin"
                          >
                            <Shield size={13} /> Make admin
                          </button>
                          <button
                            onClick={(e) => { e.preventDefault(); removeMember(m.username); }}
                            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-mist-400 hover:bg-ink-800 hover:text-red-400"
                            title="Remove member"
                          >
                            <UserMinus size={13} /> Remove
                          </button>
                        </>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="mt-5 border-t border-red-500/20 pt-4">
              <h3 className="mb-2 text-sm font-semibold text-red-400">Danger zone</h3>
              <button
                onClick={deleteCommunity}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
              >
                <Trash2 size={14} /> Delete community permanently
              </button>
            </div>
          </div>
        )}

        {/* Community feed */}
        {!loading && community && (
          <div className="mt-6">
            {community.joinedByMe && (!community.adminOnlyPosting || isAdmin) ? (
              <div className="mb-4">
                <Composer
                  endpoint={`/api/communities/${community.slug}/posts`}
                  placeholder={`Share something with ${community.name}...`}
                  onCreated={(post) => setPosts((p) => [post, ...p])}
                />
              </div>
            ) : (
              <div className="card mb-4 !p-4 text-center text-sm text-mist-400">
                {community.joinedByMe
                  ? "Only admins can post in this community."
                  : "Join the community to post here."}
              </div>
            )}

            <h2 className="mb-3 px-1 font-semibold">
              Posts {posts.length > 0 && <span className="text-mist-600">({posts.length})</span>}
            </h2>
            {community.isPrivate && !community.joinedByMe ? (
              <div className="card !p-8 text-center">
                <Lock size={20} className="mx-auto mb-2 text-mist-600" />
                <p className="text-sm text-mist-400">This community is private — join to see its posts.</p>
              </div>
            ) : posts.length === 0 ? (
              <div className="card !p-8 text-center">
                <p className="text-sm text-mist-400">No posts yet. Be the first to share!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {posts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    canModerate={isAdmin}
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
          </div>
        )}
      </AppShell>
    </>
  );
}

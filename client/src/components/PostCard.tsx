import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { timeAgo, type Post, type Comment, type FriendState, type RelationStatus } from "../lib/types";
import { CodeBlock } from "./CodeBlock";
import { Markdown } from "./Markdown";
import { FriendPicker } from "./FriendPicker";
import { Heart, MessageCircle, MoreHorizontal, Pencil, Trash2, ThumbsUp, HandHeart, PartyPopper, Angry, Repeat2, Share2, LinkIcon, Send, Pin, UserPlus, UserCheck, Clock } from "lucide-react";

// زرارين Follow / Add friend مصغّرين لصاحب البوست في هيدر الكارت.
// بنجيب حالة العلاقة أول ما الكارت يظهر، وبنخفي الأزرار لحد ما توصل عشان مايبانش وميض.
function PostAuthorActions({ username }: { username: string }) {
  const [state, setState] = useState<FriendState>("none");
  const [following, setFollowing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ ok: true } & RelationStatus>(`/api/friends/status/${username}`)
      .then((r) => {
        if (!alive) return;
        setState(r.friendState);
        setFollowing(r.following);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [username]);

  async function friendAction() {
    setBusy(true);
    try {
      if (state === "none") {
        await api("/api/friends/request", { method: "POST", body: JSON.stringify({ username }) });
        setState("request_sent");
      } else if (state === "request_sent" || state === "friends") {
        await api(`/api/friends/${username}`, { method: "DELETE" });
        setState("none");
      } else if (state === "request_received") {
        await api("/api/friends/respond", { method: "POST", body: JSON.stringify({ username, accept: true }) });
        setState("friends");
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleFollow() {
    setBusy(true);
    try {
      const r = await api<{ ok: true; following: boolean }>(`/api/friends/follow/${username}`, { method: "POST" });
      setFollowing(r.following);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  const friendIcon =
    state === "friends" ? <UserCheck size={13} />
    : state === "request_sent" ? <Clock size={13} />
    : state === "request_received" ? <UserCheck size={13} />
    : <UserPlus size={13} />;
  const friendLabel =
    state === "friends" ? "Friends"
    : state === "request_sent" ? "Requested"
    : state === "request_received" ? "Accept"
    : "Add friend";
  const friendSolid = state === "none" || state === "request_received";

  return (
    <>
      {/* على الموبايل بنعرض أيقونة بس عشان مايحصلش overflow في الهيدر؛ النص يبان من sm وفوق */}
      <button
        onClick={friendAction}
        disabled={busy}
        aria-label={friendLabel}
        title={friendLabel}
        className={
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-50 sm:px-2.5 " +
          (friendSolid ? "bg-brand-500 text-white hover:bg-brand-600" : "border border-ink-700 text-mist-100 hover:bg-ink-900")
        }
      >
        {friendIcon} <span className="hidden sm:inline">{friendLabel}</span>
      </button>
      <button
        onClick={toggleFollow}
        disabled={busy}
        className={
          "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-50 " +
          (following ? "border border-brand-500/40 bg-brand-500/10 text-brand-400" : "border border-ink-700 text-mist-100 hover:bg-ink-900")
        }
      >
        {following ? "Following" : "Follow"}
      </button>
    </>
  );
}

// كومنت واحد: بيعرض صورة صاحبه، ولو الكومنت بتاعك بيدّيك تعديل/حذف
function CommentItem({
  comment,
  postId,
  isMine,
  onUpdated,
  onDeleted,
}: {
  comment: Comment;
  postId: string;
  isMine: boolean;
  onUpdated: (c: Comment) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft.trim() || draft === comment.body) { setEditing(false); return; }
    setBusy(true);
    try {
      const res = await api<{ ok: true; comment: Comment }>(
        `/api/posts/${postId}/comments/${comment.id}`,
        { method: "PATCH", body: JSON.stringify({ body: draft }) }
      );
      onUpdated(res.comment);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this comment?")) return;
    setBusy(true);
    try {
      await api(`/api/posts/${postId}/comments/${comment.id}`, { method: "DELETE" });
      onDeleted(comment.id);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2.5">
      <Link
        to={`/u/${comment.author.username}`}
        aria-label={`${comment.author.profile.displayName} profile`}
        className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-xs font-bold hover:ring-2 hover:ring-brand-500"
      >
        {comment.author.profile.avatarUrl ? (
          <img src={comment.author.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          comment.author.profile.displayName[0]?.toUpperCase()
        )}
      </Link>
      <div className="min-w-0 flex-1 rounded-lg bg-ink-900 px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Link to={`/u/${comment.author.username}`} className="truncate font-semibold hover:underline">
            {comment.author.profile.displayName}
          </Link>
          <span className="shrink-0 text-xs text-mist-600">· {timeAgo(comment.createdAt)}</span>
          {isMine && !editing && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <button onClick={() => { setDraft(comment.body); setEditing(true); }} className="rounded p-1 text-mist-400 hover:bg-ink-800 hover:text-mist-100" aria-label="Edit comment" title="Edit">
                <Pencil size={13} />
              </button>
              <button onClick={remove} disabled={busy} className="rounded p-1 text-mist-400 hover:bg-ink-800 hover:text-red-400 disabled:opacity-50" aria-label="Delete comment" title="Delete">
                <Trash2 size={13} />
              </button>
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1.5 space-y-2">
            <textarea
              className="input-field min-h-16 resize-y !py-2 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="btn-ghost !py-1 text-xs">Cancel</button>
              <button onClick={save} disabled={busy || !draft.trim()} className="btn-primary !py-1 text-xs disabled:opacity-50">
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-mist-100">{comment.body}</p>
        )}
      </div>
    </div>
  );
}

export function PostCard({
  post,
  onDeleted,
  canModerate = false, // أدمن الكوميونتي/الصفحة: يقدر يثبّت ويمسح بوستات غيره
  onPinToggled,
}: {
  post: Post;
  onDeleted?: (id: string) => void;
  canModerate?: boolean;
  onPinToggled?: (id: string, pinned: boolean) => void;
}) {
  const { user } = useAuth();
  const isMine = user?.username === post.author.username;

  // اللايك optimistic: بنحدث الـ UI فورًا وبنرجّعه لو الطلب فشل
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [myReaction, setMyReaction] = useState<string | null>((post as any).myReaction ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [reactors, setReactors] = useState<{ type: string; username: string; displayName: string; avatarUrl: string | null }[] | null>(null);

  async function openReactors() {
    setReactorsOpen((o) => !o);
    if (reactors === null) {
      const res = await api<{ ok: true; reactions: any[] }>(`/api/posts/${post.id}/reactions`).catch(() => null);
      setReactors(res?.reactions ?? []);
    }
  }

  const REACTIONS = [
    { type: "LIKE", label: "Like", Icon: ThumbsUp, color: "text-blue-400", bg: "bg-blue-500/10" },
    { type: "LOVE", label: "Love", Icon: Heart, color: "text-red-400", bg: "bg-red-500/10" },
    { type: "SUPPORT", label: "Support", Icon: HandHeart, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { type: "CELEBRATE", label: "Celebrate", Icon: PartyPopper, color: "text-amber-400", bg: "bg-amber-500/10" },
    { type: "ANGRY", label: "Angry", Icon: Angry, color: "text-orange-500", bg: "bg-orange-500/10" },
  ] as const;

  async function react(type: string) {
    setPickerOpen(false);
    const prev = { liked, likeCount, myReaction };
    if (myReaction === type) { setMyReaction(null); setLiked(false); setLikeCount((c) => c - 1); }
    else { if (!myReaction) setLikeCount((c) => c + 1); setMyReaction(type); setLiked(true); }
    try {
      const res = await api<{ ok: true; liked: boolean; myReaction: string | null; likeCount: number }>(
        `/api/posts/${post.id}/like`,
        { method: "POST", body: JSON.stringify({ type }) }
      );
      setLiked(res.liked); setMyReaction(res.myReaction); setLikeCount(res.likeCount);
    } catch {
      setLiked(prev.liked); setMyReaction(prev.myReaction); setLikeCount(prev.likeCount);
    }
  }

  // الـ repost برضه optimistic زي اللايك
  const [reposted, setReposted] = useState(post.repostedByMe);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [repostPickerOpen, setRepostPickerOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState("");
  const [repostersOpen, setRepostersOpen] = useState(false);
  const [reposters, setReposters] = useState<{ comment: string | null; username: string; displayName: string; avatarUrl: string | null }[] | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  async function toggleRepost(comment?: string) {
    setRepostPickerOpen(false);
    setQuoteOpen(false);
    const prev = { reposted, repostCount };
    setReposted(!reposted);
    setRepostCount((c) => c + (reposted ? -1 : 1));
    try {
      const res = await api<{ ok: true; reposted: boolean; repostCount: number }>(
        `/api/posts/${post.id}/repost`,
        { method: "POST", body: JSON.stringify(comment ? { comment } : {}) }
      );
      setReposted(res.reposted);
      setRepostCount(res.repostCount);
      setQuoteDraft("");
    } catch {
      setReposted(prev.reposted);
      setRepostCount(prev.repostCount);
    }
  }

  async function openReposters() {
    setRepostersOpen((o) => !o);
    if (reposters === null) {
      const res = await api<{ ok: true; reposts: any[] }>(`/api/posts/${post.id}/reposts`).catch(() => null);
      setReposters(res?.reposts ?? []);
    }
  }

  function shareLink() {
    const url = `${window.location.origin}/post/${post.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    });
  }

  // ---- الشير لصاحب: بنبعت البوست كرسالة في الشات (من غير ما يظهر في الفيد) ----
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [commentDraft, setCommentDraft] = useState("");
  const [sending, setSending] = useState(false);

  // تعديل/حذف
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title ?? "");
  const [editBody, setEditBody] = useState(post.body);
  const [editCode, setEditCode] = useState(post.codeContent ?? "");
  const [saving, setSaving] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [currentPost, setCurrentPost] = useState(post);

  async function saveEdit() {
    setSaving(true);
    try {
      const payload =
        currentPost.type === "SNIPPET"
          ? { title: editTitle || undefined, body: editBody, codeLanguage: currentPost.codeLanguage, codeContent: editCode }
          : { title: editTitle || undefined, body: editBody };
      const res = await api<{ ok: true; post: Post }>(`/api/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setCurrentPost(res.post);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function deletePost() {
    if (!confirm("Delete this post permanently?")) return;
    try {
      await api(`/api/posts/${post.id}`, { method: "DELETE" });
      setDeleted(true);
      onDeleted?.(post.id);
    } catch {
      alert("Couldn't delete the post.");
    }
  }

  const [pinned, setPinned] = useState(post.pinned ?? false);

  async function togglePin() {
    setMenuOpen(false);
    try {
      const res = await api<{ ok: true; pinned: boolean }>(`/api/posts/${post.id}/pin`, { method: "POST" });
      setPinned(res.pinned);
      onPinToggled?.(post.id, res.pinned);
    } catch {
      alert("Couldn't pin the post.");
    }
  }

  async function openComments() {
    setShowComments((s) => !s);
    if (comments === null) {
      const res = await api<{ ok: true; comments: Comment[] }>(
        `/api/posts/${post.id}/comments`
      ).catch(() => ({ ok: true as const, comments: [] }));
      setComments(res.comments);
    }
  }

  async function sendComment() {
    if (!commentDraft.trim()) return;
    setSending(true);
    try {
      const res = await api<{ ok: true; comment: Comment }>(
        `/api/posts/${post.id}/comments`,
        { method: "POST", body: JSON.stringify({ body: commentDraft }) }
      );
      setComments((c) => [...(c ?? []), res.comment]);
      setCommentCount((n) => n + 1);
      setCommentDraft("");
    } finally {
      setSending(false);
    }
  }

  if (deleted) return null;
  const p = currentPost;

  return (
    <article className="card !p-5">
      {/* Header */}
      <div className="mb-3 flex items-center gap-3">
        <Link to={`/u/${p.author.username}`} aria-label={`${p.author.profile.displayName} profile`} className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 font-bold hover:ring-2 hover:ring-brand-500">
          {p.author.profile.avatarUrl ? (
            <img src={p.author.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            p.author.profile.displayName[0]?.toUpperCase()
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={`/u/${p.author.username}`} className="block truncate font-semibold hover:underline">
            {p.author.profile.displayName}{" "}
            <span className="font-normal text-mist-600">@{p.author.username}</span>
          </Link>
          {/* سطر المعلومات: الوقت + المجتمع/الصفحة، والـ badges بتلف تحت لو الشاشة ضيّقة */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-mist-400">
            <span className="truncate">
              {timeAgo(p.createdAt)}
              {p.community && (
                <>
                  {" · in "}
                  <Link to={`/communities/${p.community.slug}`} className="font-semibold text-brand-400 hover:underline">
                    {p.community.name}
                  </Link>
                </>
              )}
              {p.page && (
                <>
                  {" · from "}
                  <Link to={`/pages/${p.page.slug}`} className="font-semibold text-brand-400 hover:underline">
                    {p.page.name}
                  </Link>
                </>
              )}
            </span>
            {pinned && (
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-400">
                <Pin size={10} /> Pinned
              </span>
            )}
            {p.type === "QUESTION" && (
              <span className="shrink-0 whitespace-nowrap rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 font-semibold text-cyan-400">
                Help Wanted
              </span>
            )}
            {p.type === "PROJECT" && (
              <span className="shrink-0 whitespace-nowrap rounded-full border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 font-semibold text-brand-400">
                Project
              </span>
            )}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!isMine && user && <PostAuthorActions username={p.author.username} />}
          {(isMine || canModerate) && (
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center rounded px-2 py-1 text-mist-400 hover:bg-ink-900" aria-label="Post options"><MoreHorizontal size={18} /></button>
              {menuOpen && (
                <div className="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-ink-700 bg-ink-800 py-1 text-sm shadow-xl">
                  {isMine && (
                    <button onClick={() => { setEditing(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-900"><Pencil size={14} /> Edit</button>
                  )}
                  {canModerate && (
                    <button onClick={togglePin} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-900">
                      <Pin size={14} /> {pinned ? "Unpin" : "Pin to top"}
                    </button>
                  )}
                  <button onClick={() => { deletePost(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-400 hover:bg-ink-900"><Trash2 size={14} /> Delete</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body — edit mode أو عرض عادي */}
      {editing ? (
        <div className="space-y-2">
          <input className="input-field" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title (optional)" />
          <textarea className="input-field min-h-20 resize-y" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
          {p.type === "SNIPPET" && (
            <textarea className="input-field min-h-28 resize-y font-mono text-sm" value={editCode} onChange={(e) => setEditCode(e.target.value)} spellCheck={false} />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-ghost !py-1.5 text-sm">Cancel</button>
            <button onClick={saveEdit} disabled={saving || !editBody.trim()} className="btn-primary !py-1.5 text-sm disabled:opacity-50">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {p.title && <h2 className="mb-1 text-lg font-bold">{p.title}</h2>}
          <div className="text-mist-100"><Markdown>{p.body}</Markdown></div>
          {p.imageUrl && (
            <a href={p.imageUrl} target="_blank" rel="noreferrer" className="mt-3 block">
              <img src={p.imageUrl} alt="" loading="lazy" className="max-h-[420px] w-full rounded-lg border border-ink-700 object-cover" />
            </a>
          )}
          {p.type === "SNIPPET" && p.codeContent && p.codeLanguage && (
            <div className="mt-3">
              <CodeBlock code={p.codeContent} language={p.codeLanguage} />
            </div>
          )}
        </>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-3 sm:gap-5 text-sm text-mist-400">
        <div className="relative">
          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full border border-ink-700 bg-ink-800 px-2 py-1.5 shadow-xl">
              {REACTIONS.map((r) => (
                <button
                  key={r.type}
                  onClick={() => react(r.type)}
                  className={"rounded-full p-1.5 transition-transform hover:scale-125 hover:bg-ink-900 " + r.color}
                  title={r.label}
                >
                  <r.Icon size={18} className={myReaction === r.type ? "fill-current" : ""} />
                </button>
              ))}
            </div>
          )}
          {(() => {
            const active = REACTIONS.find((r) => r.type === myReaction);
            const Icon = active?.Icon ?? Heart;
            return (
              <button
                onClick={() => (myReaction ? react(myReaction) : react("LIKE"))}
                onMouseEnter={() => setPickerOpen(true)}
                onMouseLeave={() => setTimeout(() => setPickerOpen(false), 1500)}
                onContextMenu={(e) => { e.preventDefault(); setPickerOpen((o) => !o); }}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-all active:scale-90 " +
                  (active ? active.color + " " + active.bg : "hover:bg-ink-900 hover:text-red-400")
                }
                aria-pressed={liked}
              >
                <Icon size={16} />
                <span>{active ? active.label : "Like"}</span>
              </button>
            );
          })()}
        </div>
        <button onClick={openReactors} className="text-sm hover:underline" title="Who reacted">
          {likeCount}
        </button>
        <button onClick={openComments} className="flex items-center gap-1.5 hover:text-mist-100">
          <MessageCircle size={16} /> {commentCount}
        </button>

        <div className="relative">
          {repostPickerOpen && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-32 rounded-lg border border-ink-700 bg-ink-800 py-1 text-sm shadow-xl">
              <button onClick={() => toggleRepost()} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-900">
                <Repeat2 size={14} /> Repost
              </button>
              <button onClick={() => { setQuoteOpen(true); setRepostPickerOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-900">
                <Pencil size={14} /> Quote
              </button>
            </div>
          )}
          <button
            onClick={() => (reposted ? toggleRepost() : setRepostPickerOpen((o) => !o))}
            onContextMenu={(e) => { e.preventDefault(); setRepostPickerOpen((o) => !o); }}
            className={"flex items-center gap-1.5 transition-colors " + (reposted ? "text-emerald-400" : "hover:text-emerald-400")}
            aria-pressed={reposted}
            title="Repost"
          >
            <Repeat2 size={16} />
          </button>
        </div>
        <button onClick={openReposters} className="text-sm hover:underline" title="Who reposted">
          {repostCount}
        </button>

        <div className="relative">
          {shareMenuOpen && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-48 rounded-lg border border-ink-700 bg-ink-800 py-1 text-sm shadow-xl">
              <button
                onClick={() => { setShareMenuOpen(false); toggleRepost(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-900"
              >
                <Repeat2 size={14} /> Share to your profile
              </button>
              <button
                onClick={() => { setShareMenuOpen(false); setFriendPickerOpen(true); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-900"
              >
                <Send size={14} /> Send to a friend
              </button>
              <button
                onClick={() => { setShareMenuOpen(false); shareLink(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-900"
              >
                <LinkIcon size={14} /> Copy link
              </button>
            </div>
          )}
          <button
            onClick={() => setShareMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 hover:text-mist-100"
            title="Share"
          >
            <Share2 size={16} /> <span className={shareCopied ? "" : "hidden sm:inline"}>{shareCopied ? "Copied!" : "Share"}</span>
          </button>
        </div>
      </div>

      {/* Friend picker — بنبعت البوست في الشات */}
      {friendPickerOpen && (
        <FriendPicker
          message={`Check out this post by ${post.author.profile.displayName} 👇\n${window.location.origin}/post/${post.id}`}
          onClose={() => setFriendPickerOpen(false)}
        />
      )}

      {/* Quote repost box */}
      {quoteOpen && (
        <div className="mt-3 flex gap-2 border-t border-ink-700 pt-3">
          <input
            className="input-field !py-2 text-sm"
            placeholder="Add a comment (optional)..."
            value={quoteDraft}
            onChange={(e) => setQuoteDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && toggleRepost(quoteDraft.trim() || undefined)}
          />
          <button onClick={() => toggleRepost(quoteDraft.trim() || undefined)} className="btn-primary !py-2 text-sm">
            Repost
          </button>
          <button onClick={() => { setQuoteOpen(false); setQuoteDraft(""); }} className="btn-ghost !py-2 text-sm">
            Cancel
          </button>
        </div>
      )}

      {/* Reposters list */}
      {repostersOpen && (
        <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
          {reposters === null ? (
            <p className="text-xs text-mist-400">Loading...</p>
          ) : reposters.length === 0 ? (
            <p className="text-xs text-mist-400">No reposts yet.</p>
          ) : (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {reposters.map((r) => (
                <Link key={r.username} to={`/u/${r.username}`} className="flex items-center gap-2.5 rounded px-1 py-1 hover:bg-ink-800">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-xs font-bold">
                    {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" /> : r.displayName[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm">{r.displayName}</span>
                  <Repeat2 size={14} className="ml-auto text-emerald-400" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reactors list */}
      {reactorsOpen && (
        <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
          {reactors === null ? (
            <p className="text-xs text-mist-400">Loading...</p>
          ) : reactors.length === 0 ? (
            <p className="text-xs text-mist-400">No reactions yet.</p>
          ) : (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {reactors.map((r) => {
                const meta = REACTIONS.find((x) => x.type === r.type);
                const RIcon = meta?.Icon ?? Heart;
                return (
                  <Link key={r.username} to={`/u/${r.username}`} className="flex items-center gap-2.5 rounded px-1 py-1 hover:bg-ink-800">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-xs font-bold">
                      {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" /> : r.displayName[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm">{r.displayName}</span>
                    <RIcon size={14} className={"ml-auto fill-current " + (meta?.color ?? "text-red-400")} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Comments */}
      {showComments && (
        <div className="mt-4 space-y-3 border-t border-ink-700 pt-4">
          {comments === null && <p className="text-sm text-mist-400">Loading comments...</p>}
          {comments?.length === 0 && (
            <p className="text-sm text-mist-400">No comments yet. Start the thread.</p>
          )}
          {comments?.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              postId={post.id}
              isMine={user?.username === c.author.username}
              onUpdated={(uc) => setComments((cs) => (cs ?? []).map((x) => (x.id === uc.id ? uc : x)))}
              onDeleted={(id) => {
                setComments((cs) => (cs ?? []).filter((x) => x.id !== id));
                setCommentCount((n) => Math.max(0, n - 1));
              }}
            />
          ))}
          <div className="flex gap-2">
            <input
              className="input-field !py-2 text-sm"
              placeholder="Write a comment..."
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendComment()}
            />
            <button
              onClick={sendComment}
              disabled={sending || !commentDraft.trim()}
              className="btn-primary !py-2 text-sm disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

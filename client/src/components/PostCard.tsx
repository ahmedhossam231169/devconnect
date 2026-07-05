import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { timeAgo, type Post, type Comment } from "../lib/types";
import { CodeBlock } from "./CodeBlock";
import { Markdown } from "./Markdown";
import { Heart, MessageCircle, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function PostCard({ post, onDeleted }: { post: Post; onDeleted?: (id: string) => void }) {
  const { user } = useAuth();
  const isMine = user?.username === post.author.username;

  // اللايك optimistic: بنحدث الـ UI فورًا وبنرجّعه لو الطلب فشل
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);

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

  async function toggleLike() {
    const prev = { liked, likeCount };
    setLiked(!liked);
    setLikeCount((c) => c + (liked ? -1 : 1));
    try {
      const res = await api<{ ok: true; liked: boolean; likeCount: number }>(
        `/api/posts/${post.id}/like`,
        { method: "POST" }
      );
      setLiked(res.liked);
      setLikeCount(res.likeCount); // السيرفر هو مصدر الحقيقة
    } catch {
      setLiked(prev.liked); // rollback
      setLikeCount(prev.likeCount);
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
        <Link to={`/u/${p.author.username}`} className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 font-bold hover:ring-2 hover:ring-brand-500">
          {p.author.profile.avatarUrl ? (
            <img src={p.author.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            p.author.profile.displayName[0]?.toUpperCase()
          )}
        </Link>
        <div className="min-w-0">
          <Link to={`/u/${p.author.username}`} className="truncate font-semibold hover:underline">
            {p.author.profile.displayName}{" "}
            <span className="font-normal text-mist-600">@{p.author.username}</span>
          </Link>
          <p className="text-xs text-mist-400">{timeAgo(p.createdAt)}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {p.type === "QUESTION" && (
            <span className="shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-400">
              Help Wanted
            </span>
          )}
          {isMine && (
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center rounded px-2 py-1 text-mist-400 hover:bg-ink-900" aria-label="Post options"><MoreHorizontal size={18} /></button>
              {menuOpen && (
                <div className="absolute right-0 z-10 mt-1 w-32 rounded-lg border border-ink-700 bg-ink-800 py-1 text-sm shadow-xl">
                  <button onClick={() => { setEditing(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-900"><Pencil size={14} /> Edit</button>
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
          {p.type === "SNIPPET" && p.codeContent && p.codeLanguage && (
            <div className="mt-3">
              <CodeBlock code={p.codeContent} language={p.codeLanguage} />
            </div>
          )}
        </>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-5 text-sm text-mist-400">
        <button
          onClick={toggleLike}
          className={"flex items-center gap-1.5 transition-colors hover:text-red-400 " + (liked ? "text-red-400" : "")}
          aria-pressed={liked}
        >
          <Heart size={16} className={liked ? "fill-current" : ""} /> {likeCount}
        </button>
        <button onClick={openComments} className="flex items-center gap-1.5 hover:text-mist-100">
          <MessageCircle size={16} /> {commentCount}
        </button>
      </div>

      {/* Comments */}
      {showComments && (
        <div className="mt-4 space-y-3 border-t border-ink-700 pt-4">
          {comments === null && <p className="text-sm text-mist-400">Loading comments...</p>}
          {comments?.length === 0 && (
            <p className="text-sm text-mist-400">No comments yet. Start the thread.</p>
          )}
          {comments?.map((c) => (
            <div key={c.id} className="rounded-lg bg-ink-900 px-3 py-2">
              <p className="text-sm">
                <span className="font-semibold">{c.author.profile.displayName}</span>{" "}
                <span className="text-xs text-mist-600">· {timeAgo(c.createdAt)}</span>
              </p>
              <p className="mt-0.5 text-sm text-mist-100">{c.body}</p>
            </div>
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

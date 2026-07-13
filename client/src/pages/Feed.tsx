import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { FeedItem } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { Composer } from "../components/Composer";
import { PostCard } from "../components/PostCard";
import { Repeat2 } from "lucide-react";

type Sort = "latest" | "top";

export default function Feed() {
  const [sort, setSort] = useState<Sort>("latest");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: Sort) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ ok: true; items: FeedItem[]; nextCursor: string | null }>(
        `/api/posts?sort=${s}&take=10`
      );
      setItems(res.items);
      setNextCursor(res.nextCursor);
    } catch {
      setError("Couldn't load the feed. Is the server running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(sort);
  }, [sort, load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await api<{ ok: true; items: FeedItem[]; nextCursor: string | null }>(
        `/api/posts?sort=${sort}&take=10&cursor=${nextCursor}`
      );
      setItems((p) => [...p, ...res.items]);
      setNextCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const tab = (s: Sort, label: string) => (
    <button
      onClick={() => setSort(s)}
      className={
        "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors " +
        (sort === s ? "bg-brand-500 text-white" : "text-mist-400 hover:text-mist-100")
      }
    >
      {label}
    </button>
  );

  return (
    <AppShell width="narrow">
      <div className="space-y-4">
        <Composer onCreated={(post) => setItems((p) => [{ kind: "post", post }, ...p])} />

        <div className="flex gap-1">
          {tab("latest", "Latest")}
          {tab("top", "Top")}
        </div>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading feed...</p>}

        {error && (
          <div className="card !p-4 text-center">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => load(sort)} className="btn-ghost mt-3 !py-2 text-sm">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="card !p-8 text-center">
            <p className="font-semibold">The feed is empty</p>
            <p className="mt-1 text-sm text-mist-400">Be the first — share what you're building.</p>
          </div>
        )}

        {items.map((item) => {
          const onDeleted = (id: string) => setItems((prev) => prev.filter((x) => x.post.id !== id));
          if (item.kind === "post") {
            return <PostCard key={`post-${item.post.id}`} post={item.post} onDeleted={onDeleted} />;
          }
          return (
            <div key={`repost-${item.id}`}>
              <Link to={`/u/${item.reposter.username}`} className="mb-1.5 flex items-center gap-2 px-1 text-sm text-mist-400 hover:text-mist-100">
                <Repeat2 size={14} className="text-emerald-400" />
                <span className="font-semibold">{item.reposter.profile.displayName}</span> reposted
              </Link>
              {item.comment && (
                <p className="mb-2 px-1 text-sm text-mist-100">{item.comment}</p>
              )}
              <PostCard post={item.post} onDeleted={onDeleted} />
            </div>
          );
        })}

        {nextCursor && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="btn-ghost w-full justify-center text-sm disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        )}
      </div>
    </AppShell>
  );
}

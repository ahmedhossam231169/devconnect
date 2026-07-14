import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { FeedItem } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { Composer } from "../components/Composer";
import { PostCard } from "../components/PostCard";
import { FeedSidebar, ProfileStatsWidget, useFeedSidebar } from "../components/FeedWidgets";
import { Repeat2 } from "lucide-react";

type Sort = "relevant" | "latest" | "top";

export default function Feed() {
  const [sort, setSort] = useState<Sort>("relevant");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sidebar = useFeedSidebar();

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
    <AppShell width="wide" sidebarExtra={<ProfileStatsWidget stats={sidebar?.myStats} />}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* العمود الرئيسي */}
        <div className="space-y-4">
          <Composer onCreated={(post) => setItems((p) => [{ kind: "post", post }, ...p])} />

          <div className="inline-flex gap-1 rounded-full border border-ink-700/60 bg-ink-800/60 p-1">
            {tab("relevant", "Relevant")}
            {tab("latest", "Latest")}
            {tab("top", "Top")}
          </div>

          {loading && (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card space-y-3 !p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-ink-700/40" />
                    <div className="h-4 w-40 animate-pulse rounded bg-ink-700/40" />
                  </div>
                  <div className="h-4 w-3/4 animate-pulse rounded bg-ink-700/40" />
                  <div className="h-24 animate-pulse rounded-lg bg-ink-700/40" />
                </div>
              ))}
            </div>
          )}

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
              {sort === "relevant" ? (
                <>
                  <p className="font-semibold">Nothing from your network yet</p>
                  <p className="mt-1 text-sm text-mist-400">
                    Follow developers and join communities to fill this tab — or check{" "}
                    <button onClick={() => setSort("latest")} className="font-semibold text-brand-400 hover:underline">
                      Latest
                    </button>{" "}
                    to explore everyone.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold">The feed is empty</p>
                  <p className="mt-1 text-sm text-mist-400">Be the first — share what you're building.</p>
                </>
              )}
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

        {/* العمود اليمين — الويدجتات */}
        <aside className="hidden xl:block">
          <div className="sticky top-[73px]">
            <FeedSidebar data={sidebar} />
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

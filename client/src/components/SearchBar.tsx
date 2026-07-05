import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

interface SearchUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  specialty: string | null;
}
interface SearchPost {
  id: string;
  title: string | null;
  excerpt: string;
  authorName: string;
  authorUsername: string;
}

export function SearchBar() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [posts, setPosts] = useState<SearchPost[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // بحث مع debounce — نستنى 300ms بعد آخر ضغطة قبل ما نطلب
  useEffect(() => {
    if (q.trim().length < 2) {
      setUsers([]);
      setPosts([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ ok: true; users: SearchUser[]; posts: SearchPost[] }>(
          `/api/search?q=${encodeURIComponent(q.trim())}`
        );
        setUsers(res.users);
        setPosts(res.posts);
        setOpen(true);
      } catch {
        /* نتجاهل */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  // قفل عند الضغط برّا
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const hasResults = users.length > 0 || posts.length > 0;

  return (
    <div ref={boxRef} className="relative hidden max-w-xs flex-1 lg:block">
      <input
        className="input-field !py-2 text-sm"
        placeholder="Search developers, posts..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => q.trim().length >= 2 && setOpen(true)}
        aria-label="Search"
      />

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 z-20 mt-2 max-h-96 overflow-y-auto rounded-xl border border-ink-700 bg-ink-800 shadow-xl">
          {loading && !hasResults && <p className="p-4 text-center text-sm text-mist-400">Searching...</p>}
          {!loading && !hasResults && <p className="p-4 text-center text-sm text-mist-400">No results for "{q}"</p>}

          {users.length > 0 && (
            <div className="border-b border-ink-700/50">
              <p className="px-4 py-2 text-xs font-semibold text-mist-600">DEVELOPERS</p>
              {users.map((u) => (
                <Link
                  key={u.username}
                  to={`/u/${u.username}`}
                  onClick={() => { setOpen(false); setQ(""); }}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-ink-900"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-sm font-bold">
                    {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" /> : u.displayName[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{u.displayName}</p>
                    <p className="truncate text-xs text-mist-600">{u.headline ?? `@${u.username}`}</p>
                  </div>
                  {u.specialty && <span className="ml-auto shrink-0 text-xs text-brand-400">{u.specialty}</span>}
                </Link>
              ))}
            </div>
          )}

          {posts.length > 0 && (
            <div>
              <p className="px-4 py-2 text-xs font-semibold text-mist-600">POSTS</p>
              {posts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setOpen(false); setQ(""); navigate("/feed"); }}
                  className="block w-full px-4 py-2 text-left hover:bg-ink-900"
                >
                  <p className="truncate text-sm font-medium">{p.title ?? p.excerpt}</p>
                  <p className="truncate text-xs text-mist-600">by {p.authorName}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

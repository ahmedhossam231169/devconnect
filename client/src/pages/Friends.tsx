import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { UserCard } from "../lib/types";
import { AppShell } from "../components/AppShell";

export default function Friends() {
  const navigate = useNavigate();
  const [friends, setFriends] = useState<UserCard[]>([]);
  const [requests, setRequests] = useState<UserCard[]>([]);
  const [loading, setLoading] = useState(true);

  // إنشاء جروب
  const [groupMode, setGroupMode] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, r] = await Promise.all([
        api<{ ok: true; friends: UserCard[] }>("/api/friends"),
        api<{ ok: true; requests: UserCard[] }>("/api/friends/pending"),
      ]);
      setFriends(f.friends);
      setRequests(r.requests);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(username: string, accept: boolean) {
    await api("/api/friends/respond", { method: "POST", body: JSON.stringify({ username, accept }) });
    setRequests((prev) => prev.filter((u) => u.username !== username));
    if (accept) load(); // نعيد تحميل قائمة الأصدقاء
  }

  function toggleSelect(username: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(username) ? next.delete(username) : next.add(username);
      return next;
    });
  }

  async function createGroup() {
    setGroupError(null);
    setCreating(true);
    try {
      const res = await api<{ ok: true; conversationId: string }>("/api/conversations/group", {
        method: "POST",
        body: JSON.stringify({ name: groupName, usernames: [...selected] }),
      });
      navigate("/messages");
      void res;
    } catch (err) {
      setGroupError(err instanceof ApiError ? err.message : "Couldn't create the group");
    } finally {
      setCreating(false);
    }
  }

  const avatar = (u: UserCard) => (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 font-bold">
      {u.profile.avatarUrl ? (
        <img src={u.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        u.profile.displayName[0]?.toUpperCase()
      )}
    </div>
  );

  return (
    <>
      <AppShell width="narrow">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Friends</h1>
          {friends.length > 0 && (
            <button onClick={() => setGroupMode((g) => !g)} className="btn-primary !py-2 text-sm">
              {groupMode ? "Cancel" : "+ New Group"}
            </button>
          )}
        </div>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading...</p>}

        {/* وضع إنشاء الجروب */}
        {groupMode && (
          <div className="card mb-4">
            <h2 className="mb-3 font-semibold">Create a group chat</h2>
            <input
              className="input-field mb-3"
              placeholder="Group name..."
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <p className="mb-2 text-sm text-mist-400">Select friends to add:</p>
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {friends.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-900">
                  <input
                    type="checkbox"
                    checked={selected.has(u.username)}
                    onChange={() => toggleSelect(u.username)}
                    className="h-4 w-4 accent-brand-500"
                  />
                  {avatar(u)}
                  <span className="text-sm">{u.profile.displayName}</span>
                  <span className="text-xs text-mist-600">@{u.username}</span>
                </label>
              ))}
            </div>
            {groupError && <p className="mt-2 text-sm text-red-400">{groupError}</p>}
            <button
              onClick={createGroup}
              disabled={creating || !groupName.trim() || selected.size === 0}
              className="btn-primary mt-3 w-full justify-center disabled:opacity-50"
            >
              {creating ? "Creating..." : `Create group (${selected.size})`}
            </button>
          </div>
        )}

        {/* الطلبات الواردة */}
        {requests.length > 0 && !groupMode && (
          <div className="mb-6">
            <h2 className="mb-2 px-1 text-sm font-semibold text-mist-400">
              Friend requests ({requests.length})
            </h2>
            <div className="space-y-2">
              {requests.map((u) => (
                <div key={u.id} className="card flex items-center gap-3 !p-3">
                  <Link to={`/u/${u.username}`} aria-label={`${u.profile.displayName} profile`}>{avatar(u)}</Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/u/${u.username}`} className="font-semibold hover:underline">{u.profile.displayName}</Link>
                    <p className="text-xs text-mist-600">@{u.username}</p>
                  </div>
                  <button onClick={() => respond(u.username, true)} className="btn-primary !py-1.5 text-sm">Accept</button>
                  <button onClick={() => respond(u.username, false)} className="btn-ghost !py-1.5 text-sm">Decline</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* قائمة الأصدقاء */}
        {!groupMode && (
          <>
            <h2 className="mb-2 px-1 text-sm font-semibold text-mist-400">
              All friends ({friends.length})
            </h2>
            {friends.length === 0 ? (
              <div className="card !p-8 text-center">
                <p className="text-sm text-mist-400">No friends yet — find people and send requests!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {friends.map((u) => (
                  <div key={u.id} className="card flex items-center gap-3 !p-3">
                    <Link to={`/u/${u.username}`} aria-label={`${u.profile.displayName} profile`}>{avatar(u)}</Link>
                    <div className="min-w-0 flex-1">
                      <Link to={`/u/${u.username}`} className="font-semibold hover:underline">{u.profile.displayName}</Link>
                      <p className="truncate text-xs text-mist-600">
                        {u.profile.headline ?? `@${u.username}`}
                      </p>
                    </div>
                    <Link to={`/u/${u.username}`} className="btn-ghost !py-1.5 text-sm">View</Link>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </AppShell>
    </>
  );
}

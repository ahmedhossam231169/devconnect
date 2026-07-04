import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { FriendState, RelationStatus } from "../lib/types";

export function RelationActions({ username }: { username: string }) {
  const [state, setState] = useState<FriendState>("none");
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    api<{ ok: true } & RelationStatus>(`/api/friends/status/${username}`)
      .then((r) => {
        setState(r.friendState);
        setFollowing(r.following);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
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

  async function declineRequest() {
    setBusy(true);
    try {
      await api("/api/friends/respond", { method: "POST", body: JSON.stringify({ username, accept: false }) });
      setState("none");
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

  async function blockUser() {
    if (!confirm(`Block @${username}? This removes any friendship and follow between you.`)) return;
    await api(`/api/moderation/block/${username}`, { method: "POST" });
    setState("none");
    setFollowing(false);
    setMenuOpen(false);
    alert(`@${username} has been blocked.`);
  }

  async function reportUser() {
    const reason = prompt("Why are you reporting this user?");
    if (!reason?.trim()) return;
    setReporting(true);
    try {
      await api("/api/moderation/report", { method: "POST", body: JSON.stringify({ username, reason }) });
      alert("Report submitted. Our team will review it.");
    } finally {
      setReporting(false);
      setMenuOpen(false);
    }
  }

  if (loading) return null;

  const friendLabel =
    state === "friends" ? "✓ Friends"
    : state === "request_sent" ? "Request sent"
    : state === "request_received" ? "Accept request"
    : "+ Add friend";

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={friendAction}
        disabled={busy}
        className={
          "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 " +
          (state === "friends" || state === "request_sent"
            ? "border border-ink-700 text-mist-100 hover:bg-ink-900"
            : "bg-brand-500 text-white hover:bg-brand-600")
        }
      >
        {friendLabel}
      </button>

      {/* لو في طلب وارد، نضيف زرار رفض */}
      {state === "request_received" && (
        <button onClick={declineRequest} disabled={busy} className="btn-ghost !py-2 text-sm">
          Decline
        </button>
      )}

      <button
        onClick={toggleFollow}
        disabled={busy}
        className={
          "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 " +
          (following ? "border border-brand-500/40 bg-brand-500/10 text-brand-400" : "border border-ink-700 text-mist-100 hover:bg-ink-900")
        }
      >
        {following ? "Following" : "Follow"}
      </button>

      {/* قائمة الإشراف */}
      <div className="relative">
        <button onClick={() => setMenuOpen((o) => !o)} className="rounded-lg border border-ink-700 px-2.5 py-2 text-mist-400 hover:bg-ink-900" aria-label="More options">
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-ink-700 bg-ink-800 py-1 text-sm shadow-xl">
            <button onClick={reportUser} disabled={reporting} className="block w-full px-3 py-1.5 text-left hover:bg-ink-900">
              🚩 Report
            </button>
            <button onClick={blockUser} className="block w-full px-3 py-1.5 text-left text-red-400 hover:bg-ink-900">
              🚫 Block
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

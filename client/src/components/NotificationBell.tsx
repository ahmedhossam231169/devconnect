import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { timeAgo, type AppNotification } from "../lib/types";
import { Bell, Heart, MessageCircle, Repeat2, Users, UserPlus, UserCheck, UserRound } from "lucide-react";

const TYPE_ICON: Record<string, typeof Bell> = {
  POST_LIKE: Heart,
  POST_COMMENT: MessageCircle,
  POST_REPOST: Repeat2,
  COMMUNITY_JOIN: Users,
  FRIEND_REQUEST: UserPlus,
  FRIEND_ACCEPT: UserCheck,
  NEW_FOLLOWER: UserRound,
};

function NotifIcon({ type }: { type: string }) {
  const Icon = TYPE_ICON[type] ?? Bell;
  return <Icon size={16} className="text-brand-400" />;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // تحميل أولي
  useEffect(() => {
    api<{ ok: true; notifications: AppNotification[]; unreadCount: number }>("/api/notifications")
      .then((res) => {
        setNotifications(res.notifications);
        setUnreadCount(res.unreadCount);
      })
      .catch(() => {});
  }, []);

  // استقبال إشعارات جديدة real-time
  useEffect(() => {
    const s = getSocket();
    const onNew = (n: AppNotification) => {
      setNotifications((prev) => [n, ...prev].slice(0, 30));
      setUnreadCount((c) => c + 1);
    };
    s.on("notification:new", onNew);
    return () => {
      s.off("notification:new", onNew);
    };
  }, []);

  // قفل الـ dropdown لما تدوس بره
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function markOne(n: AppNotification) {
    if (n.read) return;
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await api(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
  }

  async function markAll() {
    setNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnreadCount(0);
    await api("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  const unread = notifications.filter((n) => !n.read);
  const earlier = notifications.filter((n) => n.read);

  const item = (n: AppNotification) => (
    <Link
      key={n.id}
      to={n.link ?? "#"}
      onClick={() => markOne(n)}
      className={
        "flex gap-3 px-4 py-3 text-sm transition-colors hover:bg-ink-900 " +
        (n.read ? "" : "bg-brand-500/5")
      }
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15">
        <NotifIcon type={n.type} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={n.read ? "text-mist-400" : "font-medium text-mist-100"}>{n.message}</p>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-mist-600">
          {timeAgo(n.createdAt)}
        </p>
      </div>
      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-400" />}
    </Link>
  );

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-mist-400 hover:bg-ink-800 hover:text-mist-100"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-ink-900 bg-brand-400" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 flex max-h-[70vh] w-[22rem] flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 shadow-2xl sm:w-96">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
            <p className="font-bold">Activity</p>
            {unreadCount > 0 && (
              <button onClick={markAll} className="text-xs font-semibold text-brand-400 hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="p-6 text-center text-sm text-mist-400">You're all caught up 🎉</p>
            )}

            {unread.length > 0 && (
              <>
                <p className="flex items-center justify-between px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-mist-600">
                  Unread
                  <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold text-brand-400">
                    {unread.length}
                  </span>
                </p>
                <div className="divide-y divide-ink-700/40">{unread.map(item)}</div>
              </>
            )}

            {earlier.length > 0 && (
              <>
                <p className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-mist-600">
                  Earlier
                </p>
                <div className="divide-y divide-ink-700/40">{earlier.map(item)}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

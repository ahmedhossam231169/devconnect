import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { timeAgo, type AppNotification } from "../lib/types";
import { Bell, Heart, MessageCircle, Users, UserPlus, UserCheck, UserRound } from "lucide-react";

const TYPE_ICON: Record<string, typeof Bell> = {
  POST_LIKE: Heart,
  POST_COMMENT: MessageCircle,
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

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-mist-400 hover:bg-ink-800 hover:text-mist-100"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-ink-700 bg-ink-800 shadow-xl">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAll} className="text-xs text-brand-400 hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="p-4 text-center text-sm text-mist-400">You're all caught up</p>
            )}
            {notifications.map((n) => (
              <Link
                key={n.id}
                to={n.link ?? "#"}
                onClick={() => markOne(n)}
                className={
                  "flex gap-2.5 border-b border-ink-700/50 px-4 py-3 text-sm transition-colors hover:bg-ink-900 " +
                  (n.read ? "" : "bg-brand-500/5")
                }
              >
                <span className="shrink-0"><NotifIcon type={n.type} /></span>
                <div className="min-w-0 flex-1">
                  <p className={n.read ? "text-mist-300" : "text-mist-100"}>{n.message}</p>
                  <p className="mt-0.5 text-xs text-mist-600">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { NotificationBell } from "./NotificationBell";

export function Navbar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const isRecruiter = user?.role === "RECRUITER";

  const navLink = (to: string, label: string) => (
    <Link
      to={to}
      className={
        "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors " +
        (pathname.startsWith(to)
          ? "bg-brand-500/15 text-brand-400"
          : "text-mist-400 hover:text-mist-100")
      }
    >
      {label}
    </Link>
  );

  // Recruiters بيشوفوا كل حاجة زي المطور + Talent Search كميزة إضافية ليهم
  const links = isRecruiter
    ? [
        { to: "/feed", label: "Feed" },
        { to: "/messages", label: "Messages" },
        { to: "/friends", label: "Friends" },
        { to: "/communities", label: "Communities" },
        { to: "/talent", label: "🎯 Talent Search" },
      ]
    : [
        { to: "/feed", label: "Feed" },
        { to: "/messages", label: "Messages" },
        { to: "/friends", label: "Friends" },
        { to: "/communities", label: "Communities" },
        { to: "/profile/edit", label: "Edit Profile" },
      ];

  return (
    <header className="sticky top-0 z-10 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link to="/feed" className="shrink-0 text-lg font-extrabold text-brand-400">
          ⌁ DevConnect
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => <span key={l.to}>{navLink(l.to, l.label)}</span>)}
        </div>

        {!isRecruiter && (
          <input
            className="input-field hidden max-w-xs flex-1 !py-2 text-sm lg:block"
            placeholder="Search projects, developers..."
            aria-label="Search"
          />
        )}

        <div className="flex items-center gap-3">
          {isRecruiter && (
            <span className="hidden rounded-full border border-brand-500/40 bg-brand-500/10 px-2.5 py-0.5 text-xs font-semibold text-brand-400 sm:block">
              🎯 Recruiter
            </span>
          )}
          <NotificationBell />
          <span className="hidden text-sm text-mist-400 sm:block">
            @{user?.username}
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 font-bold text-white">
            {user?.profile.displayName?.[0]?.toUpperCase() ?? "?"}
          </div>
          <button onClick={logout} className="text-sm text-mist-400 hover:text-red-400">
            Logout
          </button>
        </div>
      </nav>

      {/* nav صغيرة للموبايل تحت الهيدر */}
      <div className="flex items-center gap-1 border-t border-ink-700/60 px-4 py-1.5 md:hidden">
        {links.map((l) => <span key={l.to}>{navLink(l.to, l.label)}</span>)}
      </div>
    </header>
  );
}

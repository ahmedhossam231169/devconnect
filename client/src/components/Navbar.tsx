import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Sun, Moon, LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { NotificationBell } from "./NotificationBell";
import { SearchBar } from "./SearchBar";

export function Navbar() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const isRecruiter = user?.role === "RECRUITER";
  const [menuOpen, setMenuOpen] = useState(false);

  const links = isRecruiter
    ? [
        { to: "/feed", label: "Feed" },
        { to: "/messages", label: "Messages" },
        { to: "/friends", label: "Friends" },
        { to: "/communities", label: "Communities" },
        { to: "/pages", label: "Pages" },
        { to: "/talent", label: "Talent Search" },
        { to: "/shortlist", label: "Shortlist" },
      ]
    : [
        { to: "/feed", label: "Feed" },
        { to: "/messages", label: "Messages" },
        { to: "/friends", label: "Friends" },
        { to: "/communities", label: "Communities" },
        { to: "/pages", label: "Pages" },
        { to: "/profile/edit", label: "Edit Profile" },
      ];

  const navLink = (to: string, label: string, onClick?: () => void) => (
    <Link
      to={to}
      onClick={onClick}
      className={
        "rounded-lg px-3 py-2 text-sm font-semibold transition-colors " +
        (pathname.startsWith(to)
          ? "bg-brand-500/15 text-brand-400"
          : "text-mist-400 hover:text-mist-100")
      }
    >
      {label}
    </Link>
  );

  return (
    <>
      {/* هيدر ثابت فوق */}
      <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-mist-400 hover:bg-ink-800 md:hidden"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <Link to="/feed" className="shrink-0 text-lg font-extrabold text-brand-400">
            ⌁ DevConnect
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {links.map((l) => <span key={l.to}>{navLink(l.to, l.label)}</span>)}
          </div>

          <SearchBar />

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={toggle}
              className="rounded-lg p-2 text-mist-400 hover:bg-ink-800 hover:text-mist-100"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <NotificationBell />
            <Link
              to={`/u/${user?.username}`}
              aria-label="My profile"
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand-500 font-bold text-white transition-shadow hover:ring-2 hover:ring-brand-400"
              title="My profile"
            >
              {user?.profile.avatarUrl ? (
                <img src={user.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                user?.profile.displayName?.[0]?.toUpperCase() ?? "?"
              )}
            </Link>
            <button onClick={logout} className="hidden text-sm text-mist-400 hover:text-red-400 sm:block">
              Logout
            </button>
          </div>
        </nav>
      </header>

      {/* خلفية معتّمة خلف الـ sidebar */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar للموبايل */}
      <aside
        className={
          "fixed left-0 top-0 z-50 h-full w-72 max-w-[80%] border-r border-ink-700 bg-ink-900 " +
          "transition-transform duration-300 md:hidden " +
          (menuOpen ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-4">
          <span className="text-lg font-extrabold text-brand-400">⌁ DevConnect</span>
          <button
            onClick={() => setMenuOpen(false)}
            className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-800"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <Link
          to={`/u/${user?.username}`}
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-3 border-b border-ink-700 px-4 py-4 hover:bg-ink-800"
        >
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-brand-500 font-bold text-white">
            {user?.profile.avatarUrl ? (
              <img src={user.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              user?.profile.displayName?.[0]?.toUpperCase() ?? "?"
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{user?.profile.displayName}</p>
            <p className="truncate text-xs text-mist-600">@{user?.username}</p>
          </div>
        </Link>

        <nav className="flex flex-col gap-1 p-3">
          {links.map((l) => (
            <span key={l.to}>{navLink(l.to, l.label, () => setMenuOpen(false))}</span>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-ink-700 p-3">
          <button
            onClick={toggle}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-mist-400 hover:bg-ink-800"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-red-400 hover:bg-ink-800"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>
    </>
  );
}

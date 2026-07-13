import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Activity, Home, User, Layers, Users, MessageSquare, Contact, Flag,
  Search, Bookmark, Settings, LogOut, Menu, X, Sun, Moon,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { NotificationBell } from "./NotificationBell";
import { SearchBar } from "./SearchBar";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
}

// AppShell — الإطار الموحد للديزاين الجديد:
// topbar ثابت فوق + sidebar شمال (desktop) / drawer (mobile) + مساحة المحتوى
export function AppShell({
  children,
  width = "default",
}: {
  children: ReactNode;
  /** عرض مساحة المحتوى: narrow = فورمات/صفحات صغيرة، default = فيد، wide = داشبورد/جداول، full = بدون قيد */
  width?: "narrow" | "default" | "wide" | "full";
}) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isRecruiter = user?.role === "RECRUITER";

  const devLinks: NavItem[] = [
    { to: "/feed", label: "Feed", icon: Home },
    { to: `/u/${user?.username}`, label: "Profile", icon: User },
    { to: "/projects", label: "Projects", icon: Layers },
    { to: "/communities", label: "Communities", icon: Users },
    { to: "/messages", label: "Messages", icon: MessageSquare },
    { to: "/friends", label: "Friends", icon: Contact },
    { to: "/pages", label: "Pages", icon: Flag },
  ];

  // ملحوظة: Dashboard و Jobs هيتضافوا هنا في مرحلة الـ Jobs system
  const recruiterLinks: NavItem[] = [
    { to: "/talent", label: "Talent Search", icon: Search },
    { to: "/shortlist", label: "Shortlist", icon: Bookmark },
    { to: "/feed", label: "Feed", icon: Home },
    { to: "/communities", label: "Communities", icon: Users },
    { to: "/messages", label: "Messages", icon: MessageSquare },
    { to: "/friends", label: "Friends", icon: Contact },
    { to: "/pages", label: "Pages", icon: Flag },
  ];

  const links = isRecruiter ? recruiterLinks : devLinks;

  // الـ Feed لينك "/feed" ماينفعش يتعلم active على /talent مثلاً — مطابقة أدق
  const isActive = (to: string) => {
    if (to === "/talent") return pathname === "/talent" || /^\/talent\/(?!dashboard)/.test(pathname);
    return pathname === to || pathname.startsWith(to + "/");
  };

  const navItem = (l: NavItem, onClick?: () => void) => {
    const Icon = l.icon;
    return (
      <Link
        key={l.to}
        to={l.to}
        onClick={onClick}
        className={"side-link " + (isActive(l.to) ? "side-link-active" : "")}
      >
        <Icon size={18} strokeWidth={2} />
        {l.label}
      </Link>
    );
  };

  const sidebarFooter = (onClick?: () => void) => (
    <div className="space-y-1 border-t border-ink-700/60 p-3">
      <Link to="/profile/edit" onClick={onClick} className={"side-link " + (isActive("/profile/edit") ? "side-link-active" : "")}>
        <Settings size={18} /> Settings
      </Link>
      <button
        onClick={() => { onClick?.(); logout(); }}
        className="side-link w-full text-red-400 hover:text-red-400"
      >
        <LogOut size={18} /> Logout
      </button>
    </div>
  );

  const logo = (
    <Link to="/feed" className="flex shrink-0 items-center gap-2" aria-label="DevConnect home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
        <Activity size={18} strokeWidth={2.5} />
      </span>
      <span className="bg-gradient-to-r from-brand-400 to-brand-500 bg-clip-text text-lg font-extrabold text-transparent">
        DevConnect
      </span>
    </Link>
  );

  const maxW = {
    narrow: "max-w-2xl",
    default: "max-w-4xl",
    wide: "max-w-6xl",
    full: "max-w-none",
  }[width];

  return (
    <div className="min-h-screen">
      {/* ===== Topbar ===== */}
      <header className="sticky top-0 z-30 border-b border-ink-700/60 bg-ink-900/90 backdrop-blur">
        <nav className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-mist-400 hover:bg-ink-800 md:hidden"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            {logo}
          </div>

          <SearchBar />

          <div className="flex items-center gap-1.5 sm:gap-2">
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
              className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand-500 font-bold text-white transition-shadow hover:ring-2 hover:ring-brand-400"
              title="My profile"
            >
              {user?.profile.avatarUrl ? (
                <img src={user.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                user?.profile.displayName?.[0]?.toUpperCase() ?? "?"
              )}
            </Link>
          </div>
        </nav>
      </header>

      {/* ===== Sidebar (desktop) ===== */}
      <aside className="fixed bottom-0 left-0 top-[57px] z-20 hidden w-60 flex-col border-r border-ink-700/60 bg-ink-900 md:flex">
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {links.map((l) => navItem(l))}
        </nav>
        {sidebarFooter()}
      </aside>

      {/* ===== Drawer (mobile) ===== */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={
          "fixed left-0 top-0 z-50 flex h-full w-72 max-w-[80%] flex-col border-r border-ink-700/60 bg-ink-900 " +
          "transition-transform duration-300 md:hidden " +
          (drawerOpen ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-3">
          {logo}
          <button
            onClick={() => setDrawerOpen(false)}
            className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-800"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <Link
          to={`/u/${user?.username}`}
          onClick={() => setDrawerOpen(false)}
          className="flex items-center gap-3 border-b border-ink-700/60 px-4 py-4 hover:bg-ink-800"
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

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {links.map((l) => navItem(l, () => setDrawerOpen(false)))}
        </nav>
        {sidebarFooter(() => setDrawerOpen(false))}
      </aside>

      {/* ===== المحتوى ===== */}
      <div className="md:pl-60">
        <main className={`mx-auto w-full ${maxW} px-4 py-6 sm:px-6`}>{children}</main>
        <footer className="border-t border-ink-700/40 py-5 text-center text-xs text-mist-600">
          © {new Date().getFullYear()} DevConnect. Built for developers by developers.
        </footer>
      </div>
    </div>
  );
}

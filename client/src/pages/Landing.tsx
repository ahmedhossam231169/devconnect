import { Link, useNavigate } from "react-router-dom";
import { useState, type FormEvent } from "react";
import {
  Activity, Rocket, CheckCircle2, Users, Layers, Briefcase,
  Globe, Cpu, Code2, Zap,
} from "lucide-react";
import { GitHubIcon } from "../components/AuthLayout";

// أيقونات سوشيال مش موجودة في lucide (اتشالت أيقونات البراندات)
function TwitterIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82L5 21.75H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
    </svg>
  );
}
function LinkedInIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}

// ---------------------------------------------------------------
// Landing — مبنية بالملي من صفحة 1 في mockup الـ Visily
// ---------------------------------------------------------------

const CODE_LINES: [string, string][] = [
  // [line, css classes] — محاكاة كود المحرر في الهيرو
  ["import { LoopIn }", "text-sky-300"],
  ["  from '@core/network';", "text-emerald-300"],
  ["", ""],
  ["const community =", "text-mist-100"],
  ["  new LoopIn();", "text-brand-400"],
  ["", ""],
  ["community.onConnect(", "text-cyan-300"],
  ["  (dev) => {", "text-mist-100"],
  ["    dev.showcaseProject();", "text-mist-100"],
  ["    dev.growNetwork();", "text-mist-100"],
  ["});", "text-mist-100"],
];

const FEATURES = [
  {
    icon: Users,
    title: "Smart Networking",
    text: "Our algorithm connects you with mentors and peers based on your tech stack and experience.",
  },
  {
    icon: Layers,
    title: "Project Showcase",
    text: "Import from GitHub and build a living portfolio that recruiters can actually evaluate.",
  },
  {
    icon: Briefcase,
    title: "Direct Access",
    text: "Skip the noise. Connect directly with recruiters looking for your specific skill set.",
  },
];

const PARTNERS = [
  { icon: Globe, name: "CloudScale" },
  { icon: Cpu, name: "DevOpsFlow" },
  { icon: Code2, name: "CodeBase" },
  { icon: Zap, name: "FastStream" },
  { icon: GitHubIcon, name: "GitNexus" },
];

function FloatChip({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={
        "absolute flex items-center gap-3 rounded-xl border border-ink-700/70 bg-ink-900/95 px-4 py-3 shadow-2xl backdrop-blur " +
        (className ?? "")
      }
    >
      {icon}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-mist-600">{label}</p>
        <p className="text-sm font-bold">{value}</p>
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [newsletterEmail, setNewsletterEmail] = useState("");

  // مفيش خدمة newsletter لسه — بنوجّه المهتمين لإنشاء حساب
  function handleNewsletter(e: FormEvent) {
    e.preventDefault();
    navigate("/register");
  }

  return (
    <main>
      {/* ===== Navbar ===== */}
      <header className="sticky top-0 z-30 border-b border-ink-700/60 bg-ink-950/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
              <Activity size={18} strokeWidth={2.5} />
            </span>
            <span className="bg-gradient-to-r from-brand-400 to-brand-500 bg-clip-text text-lg font-extrabold text-transparent">
              loopIn
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Link to="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-mist-100 hover:bg-ink-800">
              Login
            </Link>
            <Link to="/register" className="btn-primary !py-2 text-sm">Sign Up</Link>
          </div>
        </nav>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(700px 450px at 8% 12%, rgba(99,102,241,0.16), transparent 70%)," +
              "radial-gradient(600px 400px at 95% 80%, rgba(14,116,144,0.14), transparent 70%)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-14 px-6 py-20 lg:grid-cols-2 lg:py-24">
          {/* الشمال: النص */}
          <div>
            <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-400">
              <Rocket size={12} /> Beta 2.0 Now Live
            </span>
            <h1 className="text-5xl font-extrabold leading-[1.08] tracking-tight md:text-6xl">
              The Architecture
              <br />
              of
              <br />
              <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-sky-400 bg-clip-text text-transparent">
                Connection.
              </span>
            </h1>
            <p className="mt-6 max-w-md text-lg text-mist-400">
              The unified ecosystem where code meets opportunity. Showcase your
              builds, scale your network, and get discovered by top-tier
              engineering recruiters.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/register" className="btn-primary">
                Join the Feed <span aria-hidden="true">→</span>
              </Link>
              <Link to="/register" className="btn-ghost bg-ink-900/60">Recruiter Access</Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-6 text-sm text-mist-400">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-brand-400" /> Free for Developers
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-brand-400" /> Verified Profiles
              </span>
            </div>
          </div>

          {/* اليمين: محرر الكود + الكروت العايمة */}
          <div className="relative hidden lg:block">
            <div className="ml-auto w-[420px] rounded-xl border border-ink-700/70 bg-ink-900/90 shadow-2xl">
              <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-2.5">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                </div>
                <span className="font-mono text-xs text-mist-600">loopin.ts</span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6">
                {CODE_LINES.map(([line, cls], i) => (
                  <div key={i} className="flex">
                    <span className="w-7 shrink-0 select-none text-right text-mist-600/60">{i + 1}</span>
                    <span className={"pl-4 " + cls}>{line}</span>
                  </div>
                ))}
              </pre>
            </div>

            <FloatChip
              className="-top-5 left-2"
              icon={<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-800 text-mist-100"><GitHubIcon size={18} /></span>}
              label="GitHub Activity"
              value="Top 2% Globally"
            />
            <FloatChip
              className="right-0 top-1/2 -translate-y-1/2"
              icon={<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/20 text-brand-400"><Zap size={18} /></span>}
              label="Reputation"
              value="2.4k Points"
            />
            <FloatChip
              className="bottom-0 left-10"
              icon={<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/90 text-white"><Code2 size={18} /></span>}
              label="Active Projects"
              value="12 Showcased"
            />
          </div>
        </div>
      </section>

      {/* ===== شريط الشركاء ===== */}
      <section className="border-y border-ink-700/40 bg-ink-900/40">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-mist-600">
            Powering the next generation of global engineering teams
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-14 gap-y-6">
            {PARTNERS.map(({ icon: Icon, name }) => (
              <span key={name} className="inline-flex items-center gap-2 text-lg font-bold text-mist-600">
                <Icon size={20} /> {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ===== المميزات ===== */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-6 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card !p-7 transition-colors hover:border-brand-500/40">
              <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400">
                <Icon size={22} />
              </span>
              <h3 className="text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="mx-auto max-w-3xl px-6 pb-28 pt-4 text-center">
        <h2 className="text-4xl font-extrabold md:text-5xl">Ready to upgrade your career?</h2>
        <p className="mx-auto mt-4 max-w-lg text-lg text-mist-400">
          Join thousands of developers and recruiters building the future of
          software engineering.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link to="/register" className="btn-primary">Create Free Account</Link>
          <Link to="/login" className="rounded-lg px-5 py-2.5 font-semibold text-mist-100 hover:bg-ink-800">
            Explore the Feed
          </Link>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-ink-700/60 bg-ink-900/50">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <span className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
                <Activity size={18} strokeWidth={2.5} />
              </span>
              <span className="text-lg font-extrabold text-brand-400">loopIn</span>
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist-400">
              The premium platform for global talent discovery and project
              showcasing in the developer ecosystem.
            </p>
            <div className="mt-5 flex gap-4 text-mist-400">
              <a href="https://github.com" target="_blank" rel="noreferrer" aria-label="GitHub" className="hover:text-mist-100"><GitHubIcon size={18} /></a>
              <a href="https://twitter.com" target="_blank" rel="noreferrer" aria-label="Twitter" className="hover:text-mist-100"><TwitterIcon size={18} /></a>
              <a href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn" className="hover:text-mist-100"><LinkedInIcon size={18} /></a>
            </div>
          </div>

          <div>
            <p className="font-bold">Platform</p>
            <ul className="mt-4 space-y-2.5 text-sm text-mist-400">
              <li><Link to="/register" className="hover:text-mist-100">Projects</Link></li>
              <li><Link to="/register" className="hover:text-mist-100">Communities</Link></li>
              <li><Link to="/register" className="hover:text-mist-100">Talent Pool</Link></li>
              <li><Link to="/register" className="hover:text-mist-100">Recruiter Tools</Link></li>
            </ul>
          </div>

          <div>
            <p className="font-bold">Resources</p>
            <ul className="mt-4 space-y-2.5 text-sm text-mist-400">
              <li><a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-mist-100">Documentation</a></li>
              <li><a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-mist-100">API Reference</a></li>
              <li><Link to="/register" className="hover:text-mist-100">Community Guidelines</Link></li>
              <li><Link to="/register" className="hover:text-mist-100">Blog</Link></li>
            </ul>
          </div>

          <div>
            <p className="font-bold">Newsletter</p>
            <p className="mt-4 text-sm text-mist-400">Stay updated with the latest in tech.</p>
            <form onSubmit={handleNewsletter} className="mt-4 flex gap-2">
              <input
                type="email"
                required
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                placeholder="Email"
                aria-label="Email for newsletter"
                className="input-field !py-2 text-sm"
              />
              <button type="submit" className="btn-primary !px-4 !py-2 text-sm">Join</button>
            </form>
          </div>
        </div>

        <div className="border-t border-ink-700/40">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-mist-600">
            <span>© {new Date().getFullYear()} loopIn Inc. All rights reserved.</span>
            <div className="flex gap-6">
              <Link to="/" className="hover:text-mist-400">Privacy Policy</Link>
              <Link to="/" className="hover:text-mist-400">Terms of Service</Link>
              <Link to="/" className="hover:text-mist-400">Cookie Settings</Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

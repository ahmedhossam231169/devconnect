import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";

interface Health {
  ok: boolean;
  service: string;
  time: string;
}

export default function Landing() {
  // أول اتصال حقيقي بين الـ frontend والـ backend
  const [health, setHealth] = useState<"loading" | "up" | "down">("loading");

  useEffect(() => {
    api<Health>("/api/health")
      .then(() => setHealth("up"))
      .catch((e: unknown) => {
        if (e instanceof ApiError) console.error(e.code, e.message);
        setHealth("down");
      });
  }, []);

  return (
    <main>
      {/* Navbar */}
      <header className="border-b border-ink-700">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-extrabold text-brand-400">⌁ DevConnect</span>
          <div className="flex items-center gap-3">
            <Link to="/login" className="btn-ghost !py-2 text-sm">Login</Link>
            <Link to="/register" className="btn-primary !py-2 text-sm">Sign up</Link>
          </div>
        </nav>
      </header>

      {/* Hero — نفس روح الـ mockup */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <span className="mb-6 inline-block rounded-full border border-brand-500/40 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-400">
          Beta — under construction
        </span>
        <h1 className="max-w-2xl text-5xl font-extrabold leading-tight md:text-6xl">
          The Architecture of <span className="text-brand-400">Connection.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-mist-400">
          The unified ecosystem where code meets opportunity. Showcase your builds,
          scale your network, and get discovered by top-tier engineering recruiters.
        </p>
        <div className="mt-8 flex gap-4">
          <Link to="/register" className="btn-primary">Join the feed →</Link>
          <Link to="/register" className="btn-ghost">Recruiter access</Link>
        </div>

        {/* مؤشر حالة الـ API — أول تواصل بين الطرفين */}
        <div className="mt-16 inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-4 py-2 font-mono text-sm">
          <span
            className={
              health === "up"
                ? "h-2 w-2 rounded-full bg-emerald-400"
                : health === "down"
                  ? "h-2 w-2 rounded-full bg-red-400"
                  : "h-2 w-2 animate-pulse rounded-full bg-mist-600"
            }
          />
          {health === "loading" && "checking API..."}
          {health === "up" && "API connected — /api/health ✓"}
          {health === "down" && "API offline — run: npm run dev (server)"}
        </div>
      </section>
    </main>
  );
}

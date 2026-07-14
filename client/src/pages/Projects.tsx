import { useState, type FormEvent } from "react";
import { AppShell } from "../components/AppShell";
import { GitHubProjects } from "../components/GitHubProjects";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";
import { Loader2 } from "lucide-react";
import { GitHubIcon } from "../components/AuthLayout";

// صفحة المشاريع — بتعرض مشاريع GitHub المستوردة لحساب المستخدم الحالي
// لو GitHub مش متربط (مسجل بإيميل/Google) بنعرض فورم ربط سريع مكانها
export default function Projects() {
  const { user } = useAuth();
  // بعد الربط الناجح بنغيّر الـ key عشان GitHubProjects يتعمله remount ويجيب الداتا
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">Projects</h1>
        <p className="mt-1 text-sm text-mist-400">
          Your live portfolio, imported straight from GitHub.
        </p>
      </div>

      {user && (
        <GitHubProjects
          key={reloadKey}
          username={user.username}
          fallback={<ConnectGitHubCard onLinked={() => setReloadKey((k) => k + 1)} />}
        />
      )}
    </AppShell>
  );
}

// ---- فورم ربط GitHub — يقبل username أو إيميل أو لينك البروفايل ----
function ConnectGitHubCard({ onLinked }: { onLinked: () => void }) {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api<{ ok: true; githubUsername: string }>("/api/profiles/me/github-link", {
        method: "POST",
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      onLinked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col items-center gap-4 !p-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400">
        <GitHubIcon size={24} />
      </span>
      <div>
        <p className="font-semibold">Show your GitHub projects here</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-mist-400">
          Enter your GitHub username, profile link, or public email — your repositories
          and stats will appear automatically.
        </p>
      </div>

      <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <input
          className="input-field flex-1"
          placeholder="username, github.com/you, or email"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !identifier.trim()} className="btn-primary justify-center text-sm disabled:opacity-60">
          {busy ? <Loader2 size={16} className="animate-spin" /> : "Connect"}
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <p className="text-xs text-mist-600">
        Tip: signing in with GitHub links your account automatically.
      </p>
    </div>
  );
}

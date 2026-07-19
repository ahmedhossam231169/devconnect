import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GitHubProjects } from "../components/GitHubProjects";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Loader2 } from "lucide-react";
import { GitHubIcon } from "../components/AuthLayout";

// صفحة المشاريع — بتعرض مشاريع GitHub المستوردة لحساب المستخدم الحالي
// [SECURITY] الربط عن طريق GitHub OAuth بس (إثبات ملكية) — مفيش كتابة username باليد
export default function Projects() {
  const { user } = useAuth();

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">Projects</h1>
        <p className="mt-1 text-sm text-mist-400">
          Your live portfolio, imported straight from GitHub.
        </p>
      </div>

      {user && <GitHubProjects username={user.username} fallback={<ConnectGitHubCard />} />}
    </AppShell>
  );
}

// ---- كارت الربط — بيوديك على GitHub OAuth تثبت إن الحساب بتاعك ----
function ConnectGitHubCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // GitHub بيرجّعنا هنا بـ ?github=<نتيجة> — بنعرض رسالة على أساسها
  const [params] = useSearchParams();
  const result = params.get("github");

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ok: true; url: string }>("/api/auth/github/connect-url");
      window.location.href = r.url; // → صفحة موافقة GitHub
    } catch {
      setError("Couldn't start GitHub connect — try again in a moment.");
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
          Verify your GitHub account once and your repositories and stats will appear
          automatically — on your profile too.
        </p>
      </div>

      <button onClick={connect} disabled={busy} className="btn-primary text-sm disabled:opacity-60">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <GitHubIcon size={16} />}
        Connect with GitHub
      </button>

      {result === "already-linked" && (
        <p className="text-sm text-red-400">
          That GitHub account is already linked to another loopIn account.
        </p>
      )}
      {result === "error" && (
        <p className="text-sm text-red-400">Something went wrong while linking — try again.</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

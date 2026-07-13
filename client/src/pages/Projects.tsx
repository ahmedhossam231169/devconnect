import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GitHubProjects } from "../components/GitHubProjects";
import { useAuth } from "../lib/auth";
import { Layers } from "lucide-react";

// صفحة المشاريع — بتعرض مشاريع GitHub المستوردة لحساب المستخدم الحالي
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

      {user && (
        <GitHubProjects
          username={user.username}
          fallback={
            <div className="card flex flex-col items-center gap-3 !p-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400">
                <Layers size={24} />
              </span>
              <p className="font-semibold">No GitHub projects yet</p>
              <p className="max-w-sm text-sm text-mist-400">
                Connect your GitHub username in your profile settings to showcase
                your repositories here automatically.
              </p>
              <Link to="/profile/edit" className="btn-primary mt-2 text-sm">
                Connect GitHub
              </Link>
            </div>
          }
        />
      )}
    </AppShell>
  );
}

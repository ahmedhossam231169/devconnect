import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { CheckCircle2 } from "lucide-react";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    setSubmitting(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  // لو مفيش توكن في الرابط أصلاً
  if (!token) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="card w-full max-w-md text-center">
          <p className="font-semibold">Invalid reset link</p>
          <p className="mt-1 text-sm text-mist-400">This link is missing or broken.</p>
          <Link to="/forgot-password" className="btn-primary mt-4 justify-center">
            Request a new one
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="mb-2 text-2xl font-extrabold text-brand-400">
        ⌁ DevConnect
      </Link>

      <div className="card w-full max-w-md">
        {done ? (
          <div className="text-center">
            <div className="mb-3 flex justify-center"><CheckCircle2 size={40} className="text-green-400" /></div>
            <h1 className="text-xl font-bold">Password updated</h1>
            <p className="mt-2 text-sm text-mist-400">Redirecting you to sign in...</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Set a new password</h1>
            <p className="mb-6 mt-1 text-sm text-mist-400">Choose a strong password you'll remember.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium">New password</label>
                <input
                  id="password"
                  type="password"
                  className="input-field"
                  placeholder="8+ characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium">Confirm password</label>
                <input
                  id="confirm"
                  type="password"
                  className="input-field"
                  placeholder="repeat it"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </p>
              )}
              <button type="submit" disabled={submitting} className="btn-primary w-full justify-center disabled:opacity-60">
                {submitting ? "Updating..." : "Update password"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

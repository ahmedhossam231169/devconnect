import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, API_BASE_URL } from "../lib/api";
import { Eye, EyeOff } from "lucide-react";
import { useAuth, type AuthUser } from "../lib/auth";

export default function Login() {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<{ ok: true; user: AuthUser; token: string }>(
        "/api/auth/login",
        { method: "POST", body: JSON.stringify({ identifier, password }) }
      );
      setSession(res.token, res.user);
      navigate(res.user.profile.onboarded ? "/feed" : "/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="mb-2 text-2xl font-extrabold text-brand-400">
        ⌁ DevConnect
      </Link>
      <p className="mb-8 text-sm text-mist-400">Built for the next generation of developers.</p>

      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mb-6 mt-1 text-sm text-mist-400">Sign in to your account to continue.</p>

        {/* OAuth */}
        <div className="grid grid-cols-2 gap-3">
          <a href={`${API_BASE_URL}/api/auth/github`} className="btn-ghost justify-center">
             GitHub
          </a>
          <a href={`${API_BASE_URL}/api/auth/google`} className="btn-ghost justify-center">
            G Google
          </a>
        </div>

        <div className="my-6 flex items-center gap-3 text-xs font-semibold tracking-wider text-mist-600">
          <span className="h-px flex-1 bg-ink-700" /> OR WITH EMAIL
          <span className="h-px flex-1 bg-ink-700" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="identifier" className="mb-1.5 block text-sm font-medium">
              Email or Username
            </label>
            <input
              id="identifier"
              className="input-field"
              placeholder="felix@devconnect.io"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className="input-field pr-12"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute inset-y-0 right-3 text-sm text-mist-400 hover:text-mist-100"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="mt-1.5 text-right">
              <Link to="/forgot-password" className="text-xs font-semibold text-brand-400 hover:underline">
                Forgot Password?
              </Link>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full justify-center disabled:opacity-60">
            {submitting ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-mist-400">
          Don't have an account?{" "}
          <Link to="/register" className="font-semibold text-brand-400 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}

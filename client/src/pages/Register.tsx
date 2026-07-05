import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, API_BASE_URL } from "../lib/api";
import { useAuth, type AuthUser } from "../lib/auth";

type Role = "DEVELOPER" | "RECRUITER";

export default function Register() {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    displayName: "",
    username: "",
    email: "",
    password: "",
  });
  const [role, setRole] = useState<Role>("DEVELOPER");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await api<{ ok: true; user: AuthUser; token: string }>(
        "/api/auth/register",
        { method: "POST", body: JSON.stringify({ ...form, role }) }
      );
      setSession(res.token, res.user);
      navigate("/onboarding");
    } catch (err) {
      if (err instanceof ApiError) {
        // أخطاء الـ Zod بتظهر تحت كل حقل لوحده
        if (err.code === "VALIDATION_ERROR") setFieldErrors(err.fieldErrors());
        else setError(err.message);
      } else {
        setError("Could not reach the server");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const FieldError = ({ name }: { name: string }) =>
    fieldErrors[name] ? (
      <p className="mt-1 text-xs text-red-400">{fieldErrors[name]}</p>
    ) : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="mb-2 text-2xl font-extrabold text-brand-400">
        ⌁ DevConnect
      </Link>
      <p className="mb-8 text-sm text-mist-400">Join the network. Ship your story.</p>

      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mb-6 mt-1 text-sm text-mist-400">Free for developers, forever.</p>

        {/* OAuth — أسرع طريقة للتسجيل */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <a href={`${API_BASE_URL}/api/auth/github`} className="btn-ghost justify-center">
             GitHub
          </a>
          <a href={`${API_BASE_URL}/api/auth/google`} className="btn-ghost justify-center">
            G Google
          </a>
        </div>
        <div className="mb-6 flex items-center gap-3 text-xs font-semibold tracking-wider text-mist-600">
          <span className="h-px flex-1 bg-ink-700" /> OR SIGN UP WITH EMAIL
          <span className="h-px flex-1 bg-ink-700" />
        </div>

        {/* اختيار نوع الحساب — أساس فلتر الـ HR من أول لحظة */}
        <div className="mb-6 grid grid-cols-2 gap-2 rounded-lg border border-ink-700 bg-ink-900 p-1">
          {(["DEVELOPER", "RECRUITER"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={
                "rounded-md px-3 py-2 text-sm font-semibold transition-colors " +
                (role === r ? "bg-brand-500 text-white" : "text-mist-400 hover:text-mist-100")
              }
            >
              {r === "DEVELOPER" ? "👩‍💻 Developer" : "🎯 Recruiter"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium">Display name</label>
            <input id="displayName" className="input-field" placeholder="Felix Sterling"
              value={form.displayName} onChange={set("displayName")} />
            <FieldError name="displayName" />
          </div>

          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-medium">Username</label>
            <input id="username" className="input-field" placeholder="felix_dev"
              value={form.username} onChange={set("username")} autoComplete="username" />
            <FieldError name="username" />
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">Email</label>
            <input id="email" type="email" className="input-field" placeholder="felix@devconnect.io"
              value={form.email} onChange={set("email")} autoComplete="email" />
            <FieldError name="email" />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">Password</label>
            <input id="password" type="password" className="input-field" placeholder="8+ characters"
              value={form.password} onChange={set("password")} autoComplete="new-password" />
            <FieldError name="password" />
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full justify-center disabled:opacity-60">
            {submitting ? "Creating account..." : "Create Free Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-mist-400">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-brand-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

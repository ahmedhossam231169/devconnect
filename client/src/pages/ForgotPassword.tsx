import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { MailCheck } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true); // دايمًا بننجح (السيرفر مش بيفرّق عشان الأمان)
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

      <div className="card w-full max-w-md">
        {sent ? (
          <div className="text-center">
            <div className="mb-3 flex justify-center"><MailCheck size={40} className="text-brand-400" /></div>
            <h1 className="text-xl font-bold">Check your email</h1>
            <p className="mt-2 text-sm text-mist-400">
              If an account exists for <b>{email}</b>, we've sent a reset link.
              It expires in 30 minutes.
            </p>
            <Link to="/login" className="btn-ghost mt-6 w-full justify-center">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Forgot password?</h1>
            <p className="mb-6 mt-1 text-sm text-mist-400">
              Enter your email and we'll send you a reset link.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium">Email</label>
                <input
                  id="email"
                  type="email"
                  className="input-field"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </p>
              )}
              <button type="submit" disabled={submitting} className="btn-primary w-full justify-center disabled:opacity-60">
                {submitting ? "Sending..." : "Send reset link"}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-mist-400">
              Remembered it?{" "}
              <Link to="/login" className="font-semibold text-brand-400 hover:underline">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

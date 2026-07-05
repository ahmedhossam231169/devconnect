import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth, type AuthUser } from "../lib/auth";

// GitHub بيرجّعنا هنا بـ ?token=... — بنخزنه ونجيب بيانات المستخدم
export default function AuthCallback() {
  const [params] = useSearchParams();
  const { setSession } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      navigate("/login");
      return;
    }
    localStorage.setItem("devconnect_token", token);
    api<{ ok: true; user: AuthUser }>("/api/auth/me")
      .then((res) => {
        setSession(token, res.user);
        navigate(res.user.profile.onboarded ? "/feed" : "/onboarding");
      })
      .catch(() => navigate("/login"));
  }, [params, setSession, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="font-mono text-sm text-mist-400">Signing you in with GitHub...</p>
    </main>
  );
}

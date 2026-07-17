import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth, type AuthUser } from "../lib/auth";
import { setAccessToken } from "../lib/token";

// السيرفر بيرجّعنا هنا بـ #token=... — بنخزنه ونجيب بيانات المستخدم
// [SECURITY] بنستخدم fragment (#) مش query (?) لأن الـ fragment ما بيتبعتش
// لأي سيرفر ولا بيتسجل في access logs ولا بيتسرب في Referer headers
export default function AuthCallback() {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const token = hashParams.get("token");
    // ننضف التوكن من شريط العنوان فورًا حتى بعد قراءته
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      navigate("/login");
      return;
    }
    // في الذاكرة بس. كوكي الـ refresh السيرفر حطه خلاص وإحنا جايين من عنده،
    // فالاستمرارية بعد الـ reload جاية منه مش من هنا.
    setAccessToken(token);
    api<{ ok: true; user: AuthUser }>("/api/auth/me")
      .then((res) => {
        setSession(token, res.user);
        navigate(res.user.profile.onboarded ? "/feed" : "/onboarding");
      })
      .catch(() => navigate("/login"));
  }, [setSession, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="font-mono text-sm text-mist-400">Signing you in with GitHub...</p>
    </main>
  );
}

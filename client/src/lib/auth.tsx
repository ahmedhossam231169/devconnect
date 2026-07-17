import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { closeSocket } from "./socket";
import {
  bootstrapSession,
  endSession,
  onSessionEnded,
  setAccessToken,
  getAccessToken,
} from "./token";

// ---------------------------------------------------------------
// AuthContext — مصدر الحقيقة الوحيد لحالة تسجيل الدخول في التطبيق
// ---------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: "DEVELOPER" | "RECRUITER";
  profile: { displayName: string; avatarUrl: string | null; headline: string | null; onboarded?: boolean };
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean; // لسه بنحاول نستعيد الجلسة من الكوكي ولا لأ
  setSession: (token: string, user: AuthUser) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

/** الـ access token بقى في الذاكرة — شوف lib/token.ts للسبب */
export const getToken = () => getAccessToken();

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // عند فتح التطبيق مفيش توكن في الذاكرة (مات مع الـ tab اللي فات)، فبنحاول
  // نطلع واحد جديد من كوكي الـ refresh. لو نجح يبقى المستخدم لسه داخل.
  useEffect(() => {
    let cancelled = false;
    bootstrapSession()
      .then(async (ok) => {
        if (!ok || cancelled) return;
        const res = await api<{ ok: true; user: AuthUser }>("/api/auth/me");
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        /* مفيش جلسة، أو الشبكة وقعت — بنفضل مسجّلين خروج */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // لو أي نداء اكتشف إن الجلسة خلصت، بنطلّع المستخدم من الواجهة مرة واحدة
  useEffect(() => onSessionEnded(() => setUser(null)), []);

  const setSession = (token: string, u: AuthUser) => {
    setAccessToken(token);
    setUser(u);
  };

  // نعيد جلب بيانات المستخدم من السيرفر (بعد onboarding أو تعديل بروفايل)
  const refresh = async () => {
    try {
      const res = await api<{ ok: true; user: AuthUser }>("/api/auth/me");
      setUser(res.user);
    } catch {
      /* نتجاهل — لو فشل نسيب الحالة زي ما هي */
    }
  };

  // بقى async: الخروج دلوقتي بيبطّل الجلسة على السيرفر كمان، مش بس بيمسح
  // التوكن محليًا. من غير النداء ده، التوكن اللي في إيد أي حد تاني بيفضل شغال.
  const logout = async () => {
    closeSocket(); // نقفل الاتصال المباشر عشان مايفضلش شغال بتوكن قديم
    await endSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, setSession, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

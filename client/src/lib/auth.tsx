import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { closeSocket } from "./socket";

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
  loading: boolean; // لسه بنتأكد من التوكن المخزن ولا لأ
  setSession: (token: string, user: AuthUser) => void;
  refresh: () => Promise<void>;
  logout: () => void;
}

const TOKEN_KEY = "devconnect_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // عند فتح التطبيق: لو في توكن مخزن، نتأكد إنه لسه صالح
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ ok: true; user: AuthUser }>("/api/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY)) // توكن بايظ/منتهي → نظّفه
      .finally(() => setLoading(false));
  }, []);

  const setSession = (token: string, u: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token);
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

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    closeSocket(); // نقفل الاتصال المباشر عشان مايفضلش شغال بتوكن قديم
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

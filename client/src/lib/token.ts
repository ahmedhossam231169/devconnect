// ---------------------------------------------------------------
// الـ access token — في الذاكرة بس، مش في localStorage
//
// قبل كده كان توكن عمره 7–30 يوم متخزن في localStorage. أي ثغرة XSS كانت
// بتقراه وتاخد الحساب لشهر، والتوكن ده مالوش إلغاء. دلوقتي اللي في الذاكرة
// عمره 15 دقيقة وبيموت مع الـ tab، والاستمرارية جاية من كوكي httpOnly
// الجافاسكريبت مش شايفاه أصلاً.
//
// الثمن: كل reload بيبدأ من غير توكن ولازم يعمل /refresh الأول (شوف
// bootstrapSession تحت). ده طلب واحد زيادة وقت فتح التطبيق، مقابل إن سرقة
// الجلسة عن طريق XSS تبقى مستحيلة بدل ما تبقى دايمة.
// ---------------------------------------------------------------
import { API_BASE_URL, registerTokenHooks } from "./api";

let accessToken: string | null = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

/** بيتنادى لما الجلسة تخلص — بيخلي أي مستمع (زي الـ AuthProvider) يعرف */
type Listener = () => void;
const sessionEndedListeners = new Set<Listener>();
export function onSessionEnded(fn: Listener): () => void {
  sessionEndedListeners.add(fn);
  return () => sessionEndedListeners.delete(fn);
}
function notifySessionEnded() {
  accessToken = null;
  for (const fn of sessionEndedListeners) fn();
}

// طلب تجديد واحد في المرة: لو 5 طلبات خدوا 401 مع بعض، مش عايزين 5 عمليات
// تجديد متوازية — دي بتتسابق على الدوران وبتولّد نفس مشكلة التابين
let inFlight: Promise<string | null> | null = null;

async function callRefresh(): Promise<string | null> {
  // بحد أقصى محاولتين: الرد 409 معناه تاب تاني سبقنا وحدّث الكوكي خلاص،
  // فالمحاولة اللي بعدها بتروح بالكوكي الجديد
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include", // الكوكي مش بيتبعت من غيرها في طلب cross-origin
      headers: { "X-Requested-With": "devconnect" }, // بيكسر CSRF — شوف السيرفر
    });

    if (res.ok) {
      const data = await res.json();
      accessToken = data.token;
      return accessToken;
    }
    if (res.status === 409) {
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    return null; // 401 أو غيره → مفيش جلسة
  }
  return null;
}

/** بيرجّع access token جديد، أو null لو الجلسة خلصت */
export function refreshAccessToken(): Promise<string | null> {
  if (!inFlight) {
    inFlight = callRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** وقت فتح التطبيق: نحاول نستعيد الجلسة من الكوكي */
export async function bootstrapSession(): Promise<boolean> {
  const token = await refreshAccessToken();
  return !!token;
}

export async function endSession(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "devconnect" },
    });
  } catch {
    // الشبكة وقعت — بنكمل الخروج محليًا برضه
  }
  notifySessionEnded();
}

/** خروج من غير نداء السيرفر (الجلسة خلصت من ناحيته أصلاً) */
export const forceEndSession = notifySessionEnded;

// api.ts بيستخدم الدوال دي عشان يجدّد لوحده وقت الـ 401
registerTokenHooks({ getAccessToken, refreshAccessToken, forceEndSession });

// ---------------------------------------------------------------
// طبقة الـ API الموحدة — كل الطلبات بتعدي من هنا
// بتضيف التوكن تلقائيًا وبتفهم شكل الـ error الموحد من الـ backend
// ---------------------------------------------------------------

// في التطوير المحلي: فاضي، فالطلبات بتتحول لـ /api/* والـ Vite proxy بيوصلها للسيرفر المحلي
// في الإنتاج: بنحط رابط الـ backend الحقيقي (على Render) في متغير بيئة VITE_API_URL
const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";
export { API_BASE_URL };

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }

  // helper: يحول تفاصيل Zod لـ map جاهز نعلّق بيه على الحقول
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const issue of this.details as ValidationIssue[]) {
      if (!out[issue.path]) out[issue.path] = issue.message;
    }
    return out;
  }
}

// بيتحقن من token.ts وقت التشغيل. الحقن ده بيكسر دايرة الـ import: token.ts
// محتاج API_BASE_URL من هنا، وهنا محتاجين نجدّد من هناك.
type TokenHooks = {
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
  forceEndSession: () => void;
};
let hooks: TokenHooks | null = null;
export const registerTokenHooks = (h: TokenHooks) => {
  hooks = h;
};

async function send(path: string, options: RequestInit, token: string | null) {
  return fetch(API_BASE_URL + path, {
    ...options,
    // الـ refresh cookie لازم يتبعت مع طلبات auth، والـ CORS بيسمح بكده
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "devconnect",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let token = hooks?.getAccessToken() ?? null;

  let res = await send(path, options, token);

  // الـ access token عمره 15 دقيقة، فالـ 401 دي حالة عادية متوقعة مش استثناء.
  // بنجدّد ونعيد الطلب مرة واحدة — باقي التطبيق مالوش دعوة بده خالص.
  if (res.status === 401 && hooks) {
    const fresh = await hooks.refreshAccessToken();
    if (fresh) {
      token = fresh;
      res = await send(path, options, token);
    } else {
      // مفيش جلسة — بنبلّغ الـ AuthProvider مرة واحدة بدل ما كل نداء
      // فاشل يعمل redirect بنفسه
      hooks.forceEndSession();
    }
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const err: ApiErrorShape = data?.error ?? { code: "UNKNOWN", message: "Unexpected error" };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }

  return data as T;
}

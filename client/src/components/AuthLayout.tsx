import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity } from "lucide-react";

// إطار موحد لصفحات الـ Auth — زي صفحة اللوجين في الديزاين:
// خلفية داكنة بتدرجات خفيفة (بنفسجي فوق شمال، تيل تحت يمين)،
// لوجو + سطر تعريفي، الكارت في النص، لينكات صغيرة وفوتر تحت
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* تدرجات الخلفية — مقاسة من الـ mockup */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 400px at 12% 8%, rgba(99,102,241,0.14), transparent 70%)," +
            "radial-gradient(700px 500px at 90% 92%, rgba(20,120,120,0.12), transparent 70%)",
        }}
      />

      <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-12">
        <Link to="/" className="mb-2 flex items-center gap-2" aria-label="loopIn home">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
            <Activity size={20} strokeWidth={2.5} />
          </span>
          <span className="text-2xl font-extrabold text-brand-400">loopIn</span>
        </Link>
        <p className="mb-8 text-sm font-semibold text-mist-100/90">
          Built for the next generation of developers.
        </p>

        {children}

        <div className="mt-8 flex gap-8 text-xs font-bold tracking-widest text-mist-600">
          <Link to="/" className="hover:text-mist-400">PRIVACY</Link>
          <Link to="/" className="hover:text-mist-400">TERMS</Link>
          <Link to="/" className="hover:text-mist-400">HELP</Link>
        </div>
      </div>

      <footer className="relative border-t border-ink-700/60 py-5 text-center text-sm text-mist-400">
        © {new Date().getFullYear()} loopIn. Built for developers by developers.
      </footer>
    </main>
  );
}

// أيقونات الـ OAuth — SVGs رسمية بسيطة
export function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.16 7.16 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

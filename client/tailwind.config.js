/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class", // نتحكم في الـ dark/light بكلاس على <html>
  theme: {
    extend: {
      // الألوان بقت متغيرات CSS — قيمتها بتتبدّل حسب الـ theme
      // نفس أسماء الكلاسات (bg-ink-800, text-mist-100...) تفضل شغالة زي ما هي
      colors: {
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
        },
        brand: {
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
        },
        mist: {
          100: "rgb(var(--mist-100) / <alpha-value>)",
          400: "rgb(var(--mist-400) / <alpha-value>)",
          600: "rgb(var(--mist-600) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

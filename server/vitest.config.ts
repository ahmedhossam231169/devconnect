import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // بس ملفات .test.ts — الـ .spec.ts القديمة سكربتات يدوية بتتشغّل
    // بـ tsx وبتحتاج سيرفر حي، فمش المفروض vitest يلمّها
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["src/tests/setup.ts"],

    // ⚠️ التشغيل بالتسلسل مقصود، مش تقصير في الأداء.
    // الاختبارات بتشترك في داتابيز واحدة وفي حالة عامة في العملية (عدادات
    // الـ rate limit، وقفل الحساب بعد المحاولات الفاشلة). لو اتنين اشتغلوا
    // مع بعض، اختبار بيستهلك حصة الـ IP وبيخلي اللي جنبه ياخد 429 — فتبقى
    // عندك اختبارات بتفشل بالتبادل من غير سبب واضح، وده أسوأ من البطء.
    fileParallelism: false,
    sequence: { concurrent: false },

    // الداتابيز على Neon (شبكة)، فالمهلة الافتراضية 5 ثواني ضيقة
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

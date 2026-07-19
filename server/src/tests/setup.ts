// ---------------------------------------------------------------
// إعداد بيئة الاختبارات — بيتشغّل قبل أي ملف اختبار
//
// ⚠️ مافيش أي import فوق عن قصد. في ESM كل الـ imports بتتنفّذ قبل جسم
// الملف، فلو استوردنا config أو prisma هنا كانوا هيقروا الـ env القديم
// قبل ما نظبّطه تحت — والحاجز ده كان هيبقى بلا معنى.
// ---------------------------------------------------------------

// 1) الحاجز: لازم داتابيز اختبارات صريحة.
//
// الاختبارات بتعمل users وبتمسح جلسات وبتعدّل صفوف. لو اشتغلت بالغلط على
// داتابيز الإنتاج هتوسّخها — وده مش سيناريو نظري، إحنا بالفعل سبنا حسابات
// اختبارية في داتابيز التطوير وإحنا بنبني السويتات دي.
//
// عشان كده مابنعملش fallback على DATABASE_URL: المتغير لازم يتحط صراحة.
// النسيان بيوقف التشغيل، مش بيوجّهه على الإنتاج بالصدفة.
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error(
    [
      "",
      "TEST_DATABASE_URL is not set.",
      "",
      "  The suite creates and deletes rows, so it refuses to guess which",
      "  database to use — pointing it at production would corrupt real data.",
      "",
      "  Local: point it at a dev/branch database (a Neon branch is ideal):",
      '    TEST_DATABASE_URL="postgresql://..." npm test',
      "",
      "  CI: use the throwaway Postgres service container.",
      "",
    ].join("\n")
  );
}

// Prisma بيقرا DATABASE_URL — فبنوجّهه لداتابيز الاختبارات قبل ما يتحمّل
process.env.DATABASE_URL = testDbUrl;
process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL ?? testDbUrl;

// 2) مفيش إيميلات حقيقية أبدًا من الاختبارات.
//
// الدرس ده اتدفع تمنه: سويت التوقيت بتضرب forgot-password ~50 مرة، وبما إن
// SMTP متظبط في .env كانت بتبعت بريد فعلي لعناوين مش موجودة — بتاكل الرصيد
// وبترفع نسبة الارتداد اللي بتضر سمعة المُرسِل. مش سايبين ده لتذكّر أي حد.
process.env.EMAIL_DISABLED = "1";

// 3) الاختبارات بتتقمّص IP لكل طلب (X-Forwarded-For) عشان تعزل نفسها عن
// حدود الـ rate limit — وده مابيشتغلش من غير trust proxy.
process.env.TRUST_PROXY = "1";

process.env.NODE_ENV ??= "test";

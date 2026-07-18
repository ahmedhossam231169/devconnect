import nodemailer from "nodemailer";
import { config } from "./config.js";

// ---------------------------------------------------------------
// إرسال الإيميلات — بيشتغل بوضعين:
// 1) لو SMTP متظبط في الـ .env → بيبعت إيميل حقيقي
// 2) لو مش متظبط → بيطبع محتوى الإيميل في الـ console (كافي للتجربة)
//
// SMTP مجاني سهل: Brevo (brevo.com) بيدي 300 إيميل/يوم مجانًا
// المتغيرات المطلوبة: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// ---------------------------------------------------------------

// config بيتأكد وقت التشغيل إن SMTP_HOST مش موجود من غير USER/PASS —
// فمفيش حالة "متظبط نص ظبط" بتفشل بصمت وقت أول إيميل
const transporter = config.hasSmtp
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    })
  : null;

// [SECURITY BUG-08] الـ subject هو header في بروتوكول الإيميل، والـ headers
// بتتفصل بسطور جديدة. أي CR/LF جوه الـ subject معناه إن اللي بعده بيتقرا
// كـ header مستقل — يعني حقن Bcc أو Reply-To في إيميل رسمي طالع باسمنا.
//
// بنعقّم هنا جوه sendEmail مش عند المستدعي: دي النقطة الوحيدة اللي كل
// الإيميلات بتعدّي منها، فمفيش مستدعي جديد يقدر ينسى الفحص. ومهم إن
// التعقيم ده مش تهريب HTML — الـ subject نص عادي مش HTML، فلو هرّبناه
// المستخدم كان هيشوف "&amp;" حرفيًا في عنوان الإيميل.
//
// ⚠️ ده مش دفاع زيادة: أسماء العرض الجاية من OAuth (gh.name / g.name في
// routes/auth.ts) بتتخزن من غير ما تمر على أي Zod schema، فالفحص ده هو
// خط الدفاع الفعلي لها.
export function headerSafe(subject: string): string {
  return subject
    // محارف التحكم كلها → مسافة. ملاحظة: CR/LF بيتغطوا مرتين (هنا وفي ضغط
    // المسافات تحت) — التكرار مقصود، أي تعديل على سطر منهم مايفتحش ثغرة لوحده.
    .replace(/[\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200); // الـ subjects الطويلة بتتقص في العملاء أصلاً
}

export async function sendEmail(to: string, rawSubject: string, html: string) {
  const subject = headerSafe(rawSubject);
  if (!transporter) {
    // وضع التطوير: نطبع بدل ما نبعت — اللينكات بتظهر في logs السيرفر
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.log("=".repeat(60));
    console.log(`[EMAIL — SMTP not configured] To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    for (const link of links) console.log(`LINK: ${link}`);
    console.log("=".repeat(60));
    return;
  }

  await transporter.sendMail({
    from: config.SMTP_FROM,
    to,
    subject,
    html,
  });
}

// حساب اتسجّل بـ OAuth (Google/GitHub) فمعندوش باسورد — نبعتله ده بدل رابط
// استرداد معمرش هيشتغل، عشان مايفضلش مستني إيميل مش جاي.
export function oauthAccountEmail(provider: string): { subject: string; html: string } {
  return {
    subject: "About signing in to DevConnect",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #6C5CE7;">⌁ DevConnect</h2>
        <p>Someone requested a password reset for your account.</p>
        <p>Your account doesn't have a password — you signed up with <b>${provider}</b>.
           Just use the <b>${provider}</b> button on the sign-in page to get in.</p>
        <p style="color:#888; font-size:13px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  };
}

export function passwordResetEmail(resetLink: string): { subject: string; html: string } {
  return {
    subject: "Reset your DevConnect password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #6C5CE7;">⌁ DevConnect</h2>
        <p>Someone requested a password reset for your account.</p>
        <p>If it was you, click the button below. The link expires in <b>30 minutes</b>.</p>
        <a href="${resetLink}"
           style="display:inline-block; background:#6C5CE7; color:#fff; padding:12px 24px;
                  border-radius:8px; text-decoration:none; font-weight:bold; margin:16px 0;">
          Reset Password
        </a>
        <p style="color:#888; font-size:13px;">
          If you didn't request this, you can safely ignore this email — your password won't change.
        </p>
      </div>
    `,
  };
}

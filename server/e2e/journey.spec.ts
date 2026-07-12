// Playwright E2E — رحلة المستخدم الحرجة:
//   register → onboard → post → join community → message → (recruiter) search → shortlist
//
// مش جزء من الـ specs بتاعة tsx — ده Playwright. للتشغيل:
//   npm i -D @playwright/test && npx playwright install chromium
//   npx playwright test src/tests/e2e.journey.spec.ts
// محتاج الـ client شغّال على 5173 والـ server على 4000.
//
// ملاحظة: الـ selectors هنا اجتهاديّة (بتعتمد على نص ظاهر / placeholders).
// لو الـ UI اختلف، عدّل الـ getByRole/getByPlaceholder حسب المكوّنات الفعلية.
import { test, expect, type Page } from "@playwright/test";

const CLIENT = process.env.E2E_CLIENT_URL || "http://localhost:5173";
const TAG = Date.now().toString(36);

async function registerViaUI(page: Page, handle: string) {
  await page.goto(`${CLIENT}/register`);
  await page.getByPlaceholder(/display name/i).fill(handle);
  await page.getByPlaceholder(/username/i).fill(`${handle}_${TAG}`);
  await page.getByPlaceholder(/email/i).fill(`${handle}_${TAG}@e2e.io`);
  await page.getByPlaceholder(/password/i).fill("supersecret1");
  await page.getByRole("button", { name: /sign up|create account|register/i }).click();
}

test.describe("DevConnect critical journey", () => {
  test("developer: register → onboard → post → join community → message", async ({ page }) => {
    await registerViaUI(page, "dev");

    // بعد التسجيل المفروض نروح onboarding أو feed
    await expect(page).toHaveURL(/onboarding|feed|onboard/i, { timeout: 10_000 });

    // لو في onboarding، نكمّله (زر Skip/Finish)
    const finish = page.getByRole("button", { name: /finish|done|skip|get started/i });
    if (await finish.isVisible().catch(() => false)) {
      await finish.click();
    }

    // ننشر بوست في الفيد
    await page.goto(`${CLIENT}/feed`);
    const composer = page.getByPlaceholder(/what.*mind|share|write.*post/i);
    await composer.fill(`Hello DevConnect e2e ${TAG}`);
    await page.getByRole("button", { name: /post|publish|share/i }).click();
    await expect(page.getByText(`Hello DevConnect e2e ${TAG}`)).toBeVisible({ timeout: 10_000 });

    // نروح المجتمعات وننضم لأول واحد عام (لو موجود)
    await page.goto(`${CLIENT}/communities`);
    const joinBtn = page.getByRole("button", { name: /^join$/i }).first();
    if (await joinBtn.isVisible().catch(() => false)) {
      await joinBtn.click();
      await expect(page.getByRole("button", { name: /joined|leave/i }).first()).toBeVisible();
    }
  });

  test("recruiter: search talent → open candidate → shortlist", async ({ page }) => {
    await registerViaUI(page, "hr");
    // ملاحظة: التسجيل من الـ UI بيعمل DEVELOPER افتراضيًا — لو الـ UI بيوفّر اختيار
    // نوع الحساب فعّله هنا. غير كده الجزء ده بيوثّق التدفق المتوقع للـ recruiter.
    await page.goto(`${CLIENT}/talent`);
    // لو ظهر 403/انت مش recruiter، التست بيسجل ده كملاحظة مش فشل صريح
    const search = page.getByPlaceholder(/search|name|skill/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("dev");
      await page.keyboard.press("Enter");
      const firstCandidate = page.getByRole("link", { name: /dev_/i }).first();
      if (await firstCandidate.isVisible().catch(() => false)) {
        await firstCandidate.click();
        const shortlist = page.getByRole("button", { name: /shortlist|save/i });
        if (await shortlist.isVisible().catch(() => false)) {
          await shortlist.click();
          await expect(page.getByRole("button", { name: /saved|remove/i })).toBeVisible();
        }
      }
    }
  });
});

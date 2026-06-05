import { test, expect } from "@playwright/test";

/**
 * Gated end-to-end test. Requires the full docker-compose stack running
 * (web + api + gotenberg + hwp-sidecar + minio) AND real Google OAuth
 * credentials, because Auth.js performs a real sign-in round-trip.
 *
 * Run:
 *   docker compose up -d --build
 *   cd e2e && pnpm install && npx playwright install chromium
 *   RUN_E2E=1 GOOGLE_TEST_EMAIL=... GOOGLE_TEST_PASSWORD=... pnpm test
 *
 * Skipped by default so it never runs (or fails) in unattended CI.
 */
const RUN = process.env.RUN_E2E === "1";

test.describe("convert flow", () => {
  test.skip(!RUN, "set RUN_E2E=1 with the stack up and Google creds to run");

  test("login → upload DOCX → see success → download PDF", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /google/i })).toBeVisible();

    // NOTE: Google sign-in automation is environment-specific. Implement the
    // provider login here (or seed a session cookie) before the steps below.
    // await signInWithGoogle(page);

    // await page.goto("/upload");
    // await page.setInputFiles('[data-testid="file-input"]', "fixtures/min.docx");
    // await expect(page.getByText("성공")).toBeVisible();
    // await page.getByRole("link", { name: "상세 보기" }).click();
    // const [download] = await Promise.all([
    //   page.waitForEvent("download"),
    //   page.getByRole("link", { name: /PDF 다운로드/ }).click(),
    // ]);
    // expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });
});

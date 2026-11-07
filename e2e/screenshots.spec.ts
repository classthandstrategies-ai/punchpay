import { test, expect } from "@playwright/test";
// Documentation screenshots of the offline simulation. Run: SCREENSHOTS=1 npm run test:e2e -- screenshots
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate docs/screenshots");

test("capture documentation screenshots", async ({ page }, info) => {
  const tag = info.project.name;
  const shot = (name: string, full = false) => page.screenshot({ path: `docs/screenshots/${tag}-${name}.png`, fullPage: full });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/simulation?scenario=accept-paint");
  await expect(page.locator(".item-file")).toBeVisible();
  await shot("sim-overview");
  await page.locator(".file-section").nth(2).scrollIntoViewIfNeeded();
  await shot("sim-evidence-review");
  await page.getByRole("button", { name: "Accept and pay $30.00" }).click();
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(page.getByText("Accepted. $30.00 paid to the contractor.")).toBeVisible();
  await shot("sim-accepted");
  await page.goto("/simulation?scenario=reject-tile");
  await page.getByRole("button", { name: "Reject and release" }).click();
  await page.getByRole("button", { name: "Confirm and release" }).click();
  await expect(page.getByText("Rejected. The $20.00 hold was released.")).toBeVisible();
  await shot("sim-rejected");
  await page.goto("/simulation?scenario=inconclusive");
  await page.locator(".report").scrollIntoViewIfNeeded();
  await shot("sim-inconclusive");
  await page.goto("/simulation?scenario=duplicate");
  await page.getByRole("button", { name: "Accept and pay $30.00" }).click();
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(page.locator(".toast.is-error")).toBeVisible();
  await shot("sim-unconfirmed");
  await page.goto("/");
  await expect(page.getByText("Design preview.")).toBeVisible();
  await shot("live-preview");
});

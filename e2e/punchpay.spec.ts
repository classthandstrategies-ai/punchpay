import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");

/** Fails the test on any console error or uncaught page error. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}
const scenario = async (page: Page, id: string) => {
  await page.goto(`/simulation?scenario=${id}`);
  await expect(page.getByText("Offline simulation · fixture data")).toBeVisible();
  await expect(page.locator(".item-file")).toBeVisible();
};
const decision = (page: Page) => page.locator("section.decision");
const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test("live page without credentials is an honest design preview", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Every fix reviewed.");
  await expect(page.getByText("Design preview.")).toBeVisible();
  await expect(page.getByText("preview, no data loaded")).toBeVisible();
  await page.getByLabel("Demo passcode").fill("wrong-passcode");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator(".access-band")).toContainText("Demo passcode required");
  await expect(page.getByRole("button", { name: /Accept and pay/ })).toHaveCount(0);
  await noHorizontalScroll(page);
  expect(errors.filter((e) => !e.includes("401"))).toEqual([]);
});

test("API refuses requests without a valid passcode and never echoes internals", async ({ request }) => {
  const list = await request.get("/api/items");
  expect(list.status()).toBe(401);
  const decide = await request.post("/api/items/d28cf4a1-2c7a-49c5-9821-115cbe6c1d11/decision", { data: { decision: "accepted" }, headers: { "x-demo-passcode": "guess-guess" } });
  expect(decide.status()).toBe(401);
  expect(await decide.json()).toEqual({ error: "Demo passcode required" });
});

test("I · accepted $30 paint repair captures exactly once", async ({ page }) => {
  const errors = watchConsole(page);
  await scenario(page, "accept-paint");
  await expect(page.getByText("Visible evidence appears to meet the criteria")).toBeVisible();
  await page.getByRole("button", { name: "Accept and pay $30.00" }).click();
  await expect(page.getByRole("button", { name: "Confirm and pay" })).toBeFocused();
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(decision(page).getByText("Accepted. $30.00 paid to the contractor.")).toBeVisible();
  await expect(decision(page).locator(".outcome")).toBeFocused();
  await expect(page.locator(".sim-count")).toHaveText(/1 capture\(s\) · 0 void\(s\)/);
  await expect(page.locator(".cf-captured .cf-value")).toHaveText("$30.00");
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("II · rejected $20 tile repair voids only the tile hold", async ({ page }) => {
  await scenario(page, "reject-tile");
  await expect(page.getByText("Visible concern against the criteria")).toBeVisible();
  await page.getByRole("button", { name: "Overlay & wipe" }).click();
  await page.getByLabel(/Before ⟷ After/).fill("20");
  await page.getByRole("button", { name: "Reject and release" }).click();
  await page.getByRole("button", { name: "Confirm and release" }).click();
  await expect(decision(page).getByText("Rejected. The $20.00 hold was released.")).toBeVisible();
  await expect(page.locator(".sim-count")).toHaveText(/1 capture\(s\) · 1 void\(s\)/);
  await expect(page.locator(".cf-voided .cf-value")).toHaveText("$20.00");
});

test("III · missing evidence blocks review and decision; upload stays in the tab", async ({ page }) => {
  await scenario(page, "missing-evidence");
  await expect(page.getByRole("radio", { name: "Contractor" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".missing-note")).toHaveText(/the after photo has not been submitted/);
  await expect(page.getByRole("button", { name: "Request advisory review" })).toBeDisabled();
  await page.getByLabel("Upload after photo").setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PNG_1x1 });
  await expect(page.locator(".missing-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Request advisory review" }).click();
  await expect(page.getByText("Simulation mode does not analyse uploaded photos")).toBeVisible();
  await page.getByRole("radio", { name: "Homeowner" }).click();
  await expect(page.getByRole("button", { name: "Accept and pay $20.00" })).toBeEnabled();
});

test("IV · inconclusive review is reported as uncertain, decision stays human", async ({ page }) => {
  await scenario(page, "inconclusive");
  await expect(page.getByText("Not enough visible evidence to say")).toBeVisible();
  await expect(page.locator(".report-count")).toContainText("0 supported · 3 uncertain · 0 not supported · views partly comparable");
  await expect(page.getByText("What these photos cannot show")).toBeVisible();
  await expect(page.getByText(/ask the contractor for a clearer photo/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and pay $30.00" })).toBeEnabled();
});

test("V · capture failure: parked, waits out in-flight window, confirms no movement, retry captures once", async ({ page }) => {
  await scenario(page, "capture-failure");
  await page.getByRole("button", { name: "Accept and pay $30.00" }).click();
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(page.locator(".toast.is-error")).toContainText("Payment outcome not confirmed");
  await expect(page.locator(".index-entry.is-current")).toContainText("Needs reconciliation");
  await page.getByRole("button", { name: "Reconcile with simulated PayPal" }).click();
  await expect(page.getByRole("status").filter({ hasText: "may still be in flight" })).toBeVisible();
  await page.waitForTimeout(4200);
  await page.getByRole("button", { name: "Reconcile with simulated PayPal" }).click();
  await expect(page.getByText("PayPal confirms no money moved. The homeowner can retry the same decision.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Reject and release/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry: accept and pay $30.00" }).click();
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(decision(page).getByText("Accepted. $30.00 paid to the contractor.")).toBeVisible();
  await expect(page.locator(".sim-count")).toHaveText(/1 capture\(s\)/);
});

test("VI · duplicate attempt is refused and reconcile finds the single capture", async ({ page }) => {
  await scenario(page, "duplicate");
  await page.getByRole("button", { name: "Accept and pay $30.00" }).click();
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(page.locator(".toast.is-error")).toContainText("Payment outcome not confirmed");
  await expect(page.locator(".sim-count")).toHaveText(/1 capture\(s\)/);
  await page.getByRole("button", { name: "Send the accept again (second tab)" }).click();
  await expect(page.locator(".sim-actions + .inline-note")).toContainText("Refused");
  await page.getByRole("button", { name: "Reconcile with simulated PayPal" }).click();
  await expect(decision(page).getByText("Accepted. $30.00 paid to the contractor.")).toBeVisible();
  await page.getByRole("button", { name: "Send the accept again (second tab)" }).click();
  await expect(page.locator(".sim-actions + .inline-note")).toContainText("already captured");
  await expect(page.locator(".sim-count")).toHaveText(/1 capture\(s\) · 0 void\(s\)/);
});

test("project closeout reports authorized, captured, voided and duplicates from recorded state", async ({ page }) => {
  await scenario(page, "accept-paint");
  const c = page.locator(".closeout");
  // Both items hold funds, nothing is decided: a zero duplicate count would be unevidenced here.
  await expect(c.locator(".cf-authorized .cf-value")).toHaveText("$50.00");
  await expect(c.locator(".cf-captured .cf-value")).toHaveText("$0.00");
  await expect(c).toContainText("Not measurable yet");

  await page.getByRole("button", { name: "Accept and pay $30.00" }).click();
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(decision(page).getByText("Accepted. $30.00 paid to the contractor.")).toBeVisible();
  await page.locator(".index-entry", { hasText: "Tile repair" }).click();
  await page.getByRole("button", { name: "Reject and release" }).click();
  await page.getByRole("button", { name: "Confirm and release" }).click();
  await expect(decision(page).getByText("Rejected. The $20.00 hold was released.")).toBeVisible();

  await expect(c.locator(".cf-authorized .cf-value")).toHaveText("$50.00");
  await expect(c.locator(".cf-captured .cf-value")).toHaveText("$30.00");
  await expect(c.locator(".cf-voided .cf-value")).toHaveText("$20.00");
  await expect(c.locator(".cf-dup .cf-value")).toHaveText("0");
  await expect(c).toContainText("Measured across 1 capture reference");
  await expect(c).toContainText("simulated states, not PayPal records");
  await noHorizontalScroll(page);
});

test("the workspace keeps evidence and the decision together, with milestones and the full log", async ({ page }) => {
  await scenario(page, "accept-paint");
  await expect(page.locator(".file-body .col-evidence .evidence-pair")).toBeVisible();
  await expect(page.locator(".file-body .col-judgment section.decision")).toBeVisible();
  // Concise milestones are shown; the complete audit history stays reachable.
  await expect(page.locator(".milestones li")).toHaveCount(5);
  const log = page.locator("details.full-log");
  await expect(log.locator(".timeline")).toBeHidden();
  await log.locator("summary").click();
  await expect(log.locator(".timeline li").first()).toBeVisible();
  // Overlay & wipe is reachable and keyboard-operable.
  await page.getByRole("button", { name: "Overlay & wipe" }).click();
  const slider = page.getByLabel(/Before ⟷ After/);
  await slider.focus();
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("49");
  await noHorizontalScroll(page);
});

test("simulated hold approval, keyboard role switching, and labels", async ({ page }) => {
  await scenario(page, "inconclusive");
  await page.getByRole("button", { name: /Tile repair/ }).click();
  await page.getByRole("button", { name: "Approve $20.00 hold (simulated buyer)" }).click();
  await expect(page.locator(".hold-line")).toContainText("held by simulated PayPal");
  await expect(page.locator(".hold-line code")).toHaveText(/^SIM-AUTH-/);
  await expect(page.locator(".hold-expiry")).toBeVisible();
  await page.getByRole("radio", { name: "Contractor" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Contractor" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("SYNTHETIC ILLUSTRATIONS · LABELED", { exact: false })).toBeVisible();
});

for (const path of ["/", "/simulation?scenario=reject-tile"]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // measure settled colours, not mid-fade frames
    await page.goto(path);
    await expect(page.locator(".item-file")).toBeVisible();
    const results = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0]).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

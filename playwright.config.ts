import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the production build (`npm run build` first). Uses the system Google Chrome,
 * so no Playwright browser download is needed. No credentials: the live page runs as a design preview
 * and /simulation runs entirely in the browser.
 */
const PORT = Number(process.env.PUNCHPAY_E2E_PORT || 3100);
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: true,
  reporter: [["list"]],
  outputDir: process.env.PUNCHPAY_E2E_OUT || "test-results",
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: "chrome", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } }
  ],
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/simulation`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DEMO_PASSCODE: "", HOMEOWNER_PASSCODE: "", CONTRACTOR_PASSCODE: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", PAYPAL_CLIENT_ID: "", PAYPAL_CLIENT_SECRET: "", ANTHROPIC_API_KEY: "" }
  }
});

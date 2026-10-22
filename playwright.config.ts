import { defineConfig, devices } from "@playwright/test"

// Locally the sandbox's Chromium is used when PLAYWRIGHT_CHROMIUM_PATH points at it
// (e.g. /opt/pw-browsers/chromium). In CI, `npx playwright install --with-deps chromium`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath, args: executablePath ? ["--no-sandbox"] : [] },
      },
    },
  ],
  // The app is served by `vite preview` from dist/, with the same headers (CSP) as Firebase Hosting
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

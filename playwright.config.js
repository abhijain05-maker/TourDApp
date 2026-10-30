import { defineConfig } from '@playwright/test'

const CAP_PORT = 4044
const DEMO_PORT = 8081

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  // UI5 pages are heavy and the tests run side by side: a busy machine must not turn into a failure
  expect: { timeout: 10_000 },
  workers: 3,
  reporter: [['list']],
  // TOURD_URL: run the browser tests against another TourD (a throwaway one, so the real database stays untouched)
  use: {
    baseURL: process.env.TOURD_URL ?? `http://localhost:${CAP_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      url: `http://localhost:${CAP_PORT}/odata/v4/tour/providers()`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // The freestyle demo app (UI5 itself comes from the CDN). Copies the player in first.
      command:
        'node ../../scripts/build-player.mjs && node ../../node_modules/@ui5/cli/bin/ui5.cjs serve --port ' +
        DEMO_PORT,
      cwd: 'samples/demo-app',
      url: `http://localhost:${DEMO_PORT}/index.html`,
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
})

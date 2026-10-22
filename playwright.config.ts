import { defineConfig } from '@playwright/test'

// Each API suite keeps its existing environment contract (HA-01 owns its servers).
// No shared webServer, URL fallback, saved session, trace or credentials in reports.
export default defineConfig({
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { trace: 'off', screenshot: 'off', video: 'off', storageState: { cookies: [], origins: [] } },
  projects: [
    { name: 'api', testDir: './tests/api' },
    { name: 'e2e', testDir: './tests/e2e', use: { browserName: 'chromium' } },
  ],
})

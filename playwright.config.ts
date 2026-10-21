import { defineConfig } from '@playwright/test'

// Suites own their isolated environment: HA-07 uses an external test server; HA-01 starts its own.
// No shared webServer or URL fallback that could target a personal development database.
export default defineConfig({
  testDir: './tests/api',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { trace: 'off' },
})

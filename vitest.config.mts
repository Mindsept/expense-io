import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // test:ci uses a production parent environment; React's act requires its test build.
    env: { NODE_ENV: 'test' },
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Include unimported production files as well as files exercised by tests.
      include: ['src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}', 'scripts/**/*.{js,mjs,cjs,ts,mts,cts}'],
      exclude: ['**/*.d.{ts,mts,cts}'],
      reportsDirectory: 'coverage/unit',
      reporter: ['text-summary', 'html', 'lcovonly', 'json-summary'],
      reportOnFailure: true,
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
})

import { defineConfig, devices } from '@playwright/test';
import { config as dotenvConfig } from 'dotenv';

// Load .env if present — no-op if the file doesn't exist
dotenvConfig();

export default defineConfig({
  testDir: './tests',

  // Maximum time a single test can run before it is considered failed
  timeout: 30_000,

  // Maximum time expect() should wait for the condition to be met
  expect: { timeout: 5_000 },

  // Run tests sequentially. Tests share a database (Docker app) so parallel
  // execution could cause race conditions and is unnecessary for 3 tests.
  fullyParallel: false,
  workers: 1,

  // Retry once on CI to handle transient flakiness (network, Docker startup)
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['html', { open: 'never' }], // generates playwright-report/ (view with npm run test:report)
    ['line'],                     // compact output in the terminal
  ],

  use: {
    // The application URL — override via BASE_URL environment variable
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',

    // Capture traces and screenshots on first retry only (keeps artifacts lean)
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // Only Chromium is configured here. Cross-browser smoke testing was
      // conducted separately on Chrome and Brave as part of the manual campaign.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

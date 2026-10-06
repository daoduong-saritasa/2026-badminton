import { defineConfig, devices } from '@playwright/test'

import { localTarget } from './tests/e2e/support/target.ts'

const target = localTarget()
const port = 5180

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.ts',
  // Every test resets the one local tournament, so tests never overlap.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'vi-VN',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: '*.phone.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'phone',
      testMatch: '*.phone.spec.ts',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    // Process variables take precedence over `.env.local`, which may name a hosted project.
    env: {
      VITE_SUPABASE_URL: target.apiUrl,
      VITE_SUPABASE_ANON_KEY: target.anonKey,
    },
  },
})

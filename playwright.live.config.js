import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://iybnjrnysiikbtokyshg.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_DpOMj8RbSkN6zgZFaxvmdw_orMCAYHu',
    },
  },
});

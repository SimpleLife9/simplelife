import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PWA_BASE_URL || 'http://127.0.0.1:4173';
const useLocalPreview = !process.env.PWA_BASE_URL;

export default defineConfig({
  testDir: './tests/pwa',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    {
      name: 'chromium-pwa-production',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: useLocalPreview
    ? {
      command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    }
    : undefined,
});

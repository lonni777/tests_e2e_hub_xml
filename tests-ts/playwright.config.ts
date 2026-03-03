import path from 'path';
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Завантажуємо .env з кореня репозиторію (tests_e2e_hub_xml/.env)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const baseURL = process.env.TEST_BASE_URL || process.env.TEST_LOGIN_URL?.replace(/\/user\/login\/?$/, '') || 'https://hubtest.kasta.ua';

// Єдиний репорт: Allure (див. docs/REPORTS_AND_ARTIFACTS.md)
const reportsDir = path.join(__dirname, '..', 'reports');

/** Mock HTTP-сервери фідів: 9876 — http-фід, 9877 — два варіанти для тесту «вимкнення фіда блокує». */
const HTTP_FEED_PORT = 9876;

export default defineConfig({
  webServer: {
    command: 'node scripts/serve-all-feeds.js',
    url: `http://localhost:${HTTP_FEED_PORT}/feed.xml`,
    reuseExistingServer: !process.env.CI,
  },
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    [
      'allure-playwright',
      {
        resultsDir: path.join(reportsDir, 'allure-results'),
        detail: true,
        suiteTitle: true,
      },
    ],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    viewport: { width: 1920, height: 1080 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  outputDir: path.join(__dirname, '..', 'test-results'),
});

import { defineConfig } from '@playwright/test';
import browser from './playwright.config';

export default defineConfig({
  ...browser,
  testDir: './tests/diagnostics',
  outputDir: 'work/rel-06/playwright',
  reporter: [['list'], ['json', { outputFile: 'work/rel-06/playwright-results.json' }]],
  use: { ...browser.use, trace: 'retain-on-failure' },
  workers: 1,
  retries: 0,
});

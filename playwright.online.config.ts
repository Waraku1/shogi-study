import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/online",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      command:
        "pnpm exec wrangler dev --local --config wrangler.jsonc --port 8788",
      url: "http://localhost:8788/api/me",
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm exec wrangler dev --local --config wrangler.test.json --port 8787",
      url: "http://localhost:8787/api/me",
      reuseExistingServer: false,
    },
    {
      command: "pnpm dev --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: false,
    },
  ],
});

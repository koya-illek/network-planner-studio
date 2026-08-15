import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8795",
    viewport: { width: 1440, height: 1000 },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: "npx wrangler dev --local --host 127.0.0.1 --port 8795",
    url: "http://127.0.0.1:8795",
    reuseExistingServer: true,
    timeout: 30_000
  }
});

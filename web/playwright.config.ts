import { defineConfig, devices } from '@playwright/test';

// Ports come from the environment so several e2e runs can share a machine (default 3000/8000).
const WEB_PORT = process.env.WEB_PORT ?? '3000';
const API_PORT = process.env.API_PORT ?? '8000';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // One worker: the mock model's answer queue is shared by the whole API process.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // A fresh database (mkt_e2e_<port>) and the mock model; see server/scripts/e2e-server.ts.
      command: 'pnpm e2e:server',
      cwd: '../server',
      env: { PORT: API_PORT },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT} --hostname 127.0.0.1`,
      env: { API_PORT },
      url: `http://127.0.0.1:${WEB_PORT}/app/brands`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});

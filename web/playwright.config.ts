import { defineConfig } from '@playwright/test'

const PORT = 7791

// The built page served by `hyper serve --fake`: the fake daemon starts with demo sessions,
// and /api/fake lets a test change them. A fresh state dir each run gives an empty board.json.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    viewport: { width: 1920, height: 1080 },
  },
  webServer: {
    command: `pnpm build && sh -c 'uv run --project .. hyper serve --fake --port ${PORT} --state-dir "$(mktemp -d)"'`,
    url: `http://127.0.0.1:${PORT}/api/board`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

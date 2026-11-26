import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 240000,
  expect: { timeout: 15000 },
  use: {
    actionTimeout: 30000,
    baseURL: "http://127.0.0.1:8766",
    viewport: { width: 1440, height: 1050 },
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--disable-features=AudioServiceSandbox",
        "--disable-audio-output",
        "--use-file-for-fake-audio-capture=" +
          resolve("../local-model-tests/audio/presentation.wav"),
      ],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "../.venv/bin/python ../scripts/test_server.py",
    url: "http://127.0.0.1:8766/api/health",
    timeout: 30000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL:
        "postgresql+psycopg://postgres@127.0.0.1:5432/tuto_browser_test",
      DATA_DIR: resolve("../.runtime/browser-media"),
    },
  },
  reporter: "list",
});

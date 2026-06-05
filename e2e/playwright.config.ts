import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:8081",
    headless: true,
  },
});

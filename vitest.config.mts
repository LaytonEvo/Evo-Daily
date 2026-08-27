import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // Integration tests hit a real database and take longer than unit tests.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Database-backed suites share tables; run files one at a time.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});

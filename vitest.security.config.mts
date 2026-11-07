import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

process.loadEnvFile(".env");
const testUrl = new URL(process.env.DATABASE_URL!);
testUrl.pathname = "/envshare_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/security/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: testUrl.toString(),
      ENCRYPTION_KEY: "c3".repeat(32), // a throwaway key, never your real one
      JWT_SECRET: "x".repeat(40),
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
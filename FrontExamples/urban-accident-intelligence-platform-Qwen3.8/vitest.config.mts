import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 600000,
    hookTimeout: 600000,
    pool: "forks",
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});

import { defineConfig } from "vitest/config";
import path from "path";
import "dotenv/config";
export default defineConfig({ resolve: { alias: { "@": path.resolve(__dirname, "src") } }, test: { include: ["src/**/*.test.ts"], environment: "node" } });

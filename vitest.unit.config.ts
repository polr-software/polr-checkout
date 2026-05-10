import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["polr-source"],
    },
  },
  test: {
    environment: "node",
    exclude: ["**/dist/**", "**/node_modules/**", "apps/**"],
    include: ["packages/**/__tests__/**/*.test.ts"],
  },
});

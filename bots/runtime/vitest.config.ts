import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: process.env.ENDIX_LIVE_SDK === "1" ? [] : ["test/live/**"],
    setupFiles: ["test/helpers/setup.ts"],
  },
});

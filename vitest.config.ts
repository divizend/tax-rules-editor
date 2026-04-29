import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Keep UI tests separate from node:test-based domain tests under src/**/__tests__.
    include: ["**/*.vitest.{test,spec}.{ts,tsx}"],
    css: false,
    restoreMocks: true,
    clearMocks: true,
    unstubGlobals: true,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
})


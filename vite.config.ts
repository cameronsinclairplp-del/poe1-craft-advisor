import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

// BASE_PATH is set by the GitHub Pages deploy workflow to "/<repo>/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [preact()],
  build: { target: "es2022", sourcemap: true },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // The parity suite replays 5.6 million rolls; give it room.
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});

import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  clearScreen: false,
  test: {
    environment: "jsdom",
  },
  server: {
    port: 1432,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

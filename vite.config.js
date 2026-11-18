import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

export default defineConfig({
  plugins: [preact()],
  clearScreen: false,
  test: {
    environment: "jsdom",
    // Node 25 以降は組み込みの localStorage(保存先のファイルを指定しないと使えない)が
    // jsdom のものを覆ってしまう。テストでは Node 側を切り、jsdom のものを使う
    poolOptions: {
      forks: { execArgv: NODE_MAJOR >= 22 ? ["--no-experimental-webstorage"] : [] },
    },
  },
  server: {
    port: 1432,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

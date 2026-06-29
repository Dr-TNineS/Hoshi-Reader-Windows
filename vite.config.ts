import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  base: "./",
  server: {
    watch: {
      ignored: ["**/src-tauri/target*/**"],
    },
  },
  build: {
    target: "esnext",
  },
});

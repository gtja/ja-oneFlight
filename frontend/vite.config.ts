import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target:
          process.env.ONEFLIGHT_API_PROXY_URL ||
          process.env.ONEFLIGHT_API_URL ||
          "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: { chunkSizeWarningLimit: 1100 },
});

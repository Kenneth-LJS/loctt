import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// During `npm run dev` the React app runs on Vite's port and proxies
// `/api/*` calls to the Node server (default :7700). The proxy target
// is taken from LOCTT_API_PORT so devs running the server on a
// non-default port don't need to edit this file.
const apiPort = process.env.LOCTT_API_PORT ?? "7700";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});

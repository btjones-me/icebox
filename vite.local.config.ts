import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      allowedHosts: ["127.0.0.1", "localhost", "terminal.local"],
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
        },
      },
    },
  }),
);
